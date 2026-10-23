import { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import Keyboard, { KeyboardReactInterface } from 'react-simple-keyboard';

// Last, and in this order: the package's own stylesheet first so the
// Satellite theme overrides it. ConfigProvider.tsx places its CSS import
// the same way.
import 'react-simple-keyboard/build/css/index.css';
import './keyboard.css';

/**
 * The on-screen keyboard for the sign-in pages.
 *
 * Observatory is embedded in Satellite on a factory-floor panel that has no
 * physical keyboard, so without this nobody standing at the machine can sign
 * in at all. The panel already shows Satellite's keyboard everywhere else,
 * and the two have to look like one keyboard — `keyboard.css` is therefore a
 * verbatim copy of Satellite's, and the behaviour below follows
 * `orbiter/packages/ui/src/providers/keyboard.provider.tsx` key for key.
 *
 * Two things differ from Satellite's, both forced by where this runs:
 *
 * - **Nothing registers with it.** Satellite's inputs call `register()` on
 *   focus, because Satellite owns its inputs. These are Grafana's, so this
 *   watches `focusin` instead and attaches itself to whatever typable field
 *   the operator touched.
 * - **Only the text layouts.** Satellite carries a numpad and a calculator
 *   for its setpoint fields. A sign-in form has no numbers to clamp, so
 *   those, and the min/max handling that goes with them, are left out rather
 *   than carried unused.
 */

const KEYBOARD_WIDTH = 1000;
const GAP = 10;

/** Height of the four-row text layout, for deciding above or below. */
const KEYBOARD_HEIGHT = 394;

type LayoutName = 'default' | 'shift' | 'german' | 'shiftgerman';

/** Satellite's layouts, minus numpad and calculator. */
const LAYOUT = {
  default: [
    '` 1 2 3 4 5 6 7 8 9 0 - = {bksp}',
    '{tab} q w e r t y u i o p [ ] \\',
    "{lock} a s d f g h j k l ; ' {enter}",
    '{shift} z x c v b n m , . / {shift}',
    '.com @ {space}',
  ],
  german: [
    '^ 1 2 3 4 5 6 7 8 9 0 ß ´ {bksp}',
    '{tab} q w e r t z u i o p ü +',
    '{lock} a s d f g h j k l ö ä # {enter}',
    '{shift} < y x c v b n m , . - {shift}',
    '.com @ {space}',
  ],
  shift: [
    '~ ! @ # $ % ^ & * ( ) _ + {bksp}',
    '{tab} Q W E R T Y U I O P { } |',
    '{lock} A S D F G H J K L : " {enter}',
    '{shift} Z X C V B N M &lt; &gt; ? {shift}',
    '.com @ {space}',
  ],
  shiftgerman: [
    '° ! " § $ % & / ( ) = ? ` {bksp}',
    '{tab} Q W E R T Z U I O P Ü *',
    "{lock} A S D F G H J K L Ö Ä ' {enter}",
    '{shift} &gt; Y X C V B N M ; : _ {shift}',
    '.com @ {space}',
  ],
};

const DISPLAY = {
  '{bksp}': '⌫',
  '{enter}': '↵',
  '{lock}': '⇪',
  '{shift}': '⇧',
  '{tab}': '⇥',
  '{space}': '␣',
};

/**
 * Whether Observatory is running inside someone else's page.
 *
 * The same rule the plugin uses, so one answer governs the whole app: the
 * query parameter wins where it is given, otherwise being framed is the
 * test. `?embed=0` is what makes the sign-in page testable in a tab.
 */
export function isEmbedded(): boolean {
  const forced = new URLSearchParams(window.location.search).get('embed');
  if (forced === '1' || forced === 'true') {
    return true;
  }
  if (forced === '0' || forced === 'false') {
    return false;
  }
  // Comparing the window objects is safe across origins — it is reading
  // *through* top that throws, which this never does.
  return window.self !== window.top;
}

/**
 * QWERTZ or QWERTY.
 *
 * Satellite sets `?lang=de|en` on the frame, and the plugin reads it — but
 * it does not survive the trip to this page. An unauthenticated request is
 * answered with a bare redirect to `/login`, the original URI going into the
 * `redirect_to` cookie, which is HttpOnly and so unreadable here. The
 * parameter is still read first in case the frame is pointed at `/login`
 * directly one day.
 *
 * After that the browser's own locale, and German last — every customer so
 * far reads German, and on the wrong guess the two layouts differ only in
 * y/z and the umlauts, so the shift key is never the thing standing between
 * an operator and their password.
 */
function initialLayout(): LayoutName {
  const param = new URLSearchParams(window.location.search).get('lang');
  const lang = (param || navigator.language || 'de').toLowerCase();
  return lang.startsWith('en') ? 'default' : 'german';
}

/** Fields worth a keyboard — not checkboxes, buttons or pickers. */
const TYPABLE = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number', '']);

function isTypable(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) {
    return !el.readOnly && !el.disabled;
  }
  return el instanceof HTMLInputElement && !el.readOnly && !el.disabled && TYPABLE.has(el.type);
}

export function OnScreenKeyboard() {
  const [target, setTarget] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [layoutName, setLayoutName] = useState<LayoutName>(initialLayout);
  const keyboardRef = useRef<KeyboardReactInterface | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const place = useCallback((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const { scrollX, scrollY } = window;

    // Centred on the field, then pulled back inside the viewport.
    const centre = rect.left + scrollX + rect.width / 2;
    const left = Math.max(0, Math.min(centre - KEYBOARD_WIDTH / 2, window.innerWidth + scrollX - KEYBOARD_WIDTH));

    // Below by default; above when below would run off the bottom.
    let top = rect.bottom + scrollY + GAP;
    if (top + KEYBOARD_HEIGHT > window.innerHeight + scrollY) {
      top = rect.top + scrollY - KEYBOARD_HEIGHT - GAP;
    }
    setPosition({ top, left });
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    setPosition(null);
  }, []);

  // Attach on focus, since Grafana's inputs know nothing about this.
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      if (!isTypable(e.target)) {
        return;
      }
      const el = e.target;
      place(el);
      setTarget(el);
    }

    // A press outside both the field and the keyboard dismisses it. Capture
    // phase, so it still fires for handlers that stop propagation.
    function onPointerDown(e: Event) {
      const hit = e.target;
      if (!target || !(hit instanceof Node)) {
        return;
      }
      if (!containerRef.current?.contains(hit) && !target.contains(hit)) {
        close();
      }
    }

    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close();
      }
    }

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, true);
    document.addEventListener('keydown', onEscape, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('touchstart', onPointerDown, true);
      document.removeEventListener('keydown', onEscape, true);
    };
  }, [target, place, close]);

  // Shift changes the layout's height by a row on some languages, so the
  // keyboard re-places itself rather than drifting over the field.
  useEffect(() => {
    if (target) {
      place(target);
    }
  }, [layoutName, target, place]);

  // After mount, not on focus: the keyboard does not exist until a field has
  // one, so seeding it from the focus handler set nothing the first time.
  useEffect(() => {
    if (target) {
      keyboardRef.current?.setInput(target.value);
    }
  }, [target]);

  const press = (button: string) => {
    if (!target) {
      return;
    }

    if (button === '{shift}' || button === '{lock}') {
      setLayoutName((old) =>
        old === 'default' ? 'shift' : old === 'shift' ? 'default' : old === 'german' ? 'shiftgerman' : 'german'
      );
      return;
    }

    if (button === '{enter}') {
      // Submits the form the field belongs to, which is what Enter does on a
      // real keyboard — and the whole point of signing in.
      const form = target.closest('form');
      target.blur();
      close();
      form?.requestSubmit();
      return;
    }

    const value = target.value ?? '';
    const selStart = typeof target.selectionStart === 'number' ? target.selectionStart : value.length;
    const selEnd = typeof target.selectionEnd === 'number' ? target.selectionEnd : selStart;
    const start = Math.min(selStart, selEnd);
    const end = Math.max(selStart, selEnd);
    const before = value.slice(0, start);
    const after = value.slice(end);

    let next = value;
    let caret = start;

    if (button === '{bksp}') {
      if (start !== end) {
        next = before + after;
        caret = before.length;
      } else if (start > 0) {
        next = value.slice(0, start - 1) + after;
        caret = start - 1;
      }
    } else {
      const insert = button === '{space}' ? ' ' : button === '{tab}' ? '\t' : button;
      next = before + insert + after;
      caret = before.length + insert.length;
    }

    // Through the prototype's setter, not `target.value =`. React installs
    // its own setter on the element, and assigning directly leaves its
    // internal value tracker thinking nothing changed — the input event
    // fires and react-hook-form ignores it, so the form submits empty.
    const proto = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(target, next);

    keyboardRef.current?.setInput(next);

    const clamped = Math.max(0, Math.min(next.length, caret));
    try {
      target.setSelectionRange(clamped, clamped);
    } catch {
      // Some input types have no selection to set; the value still landed.
    }
    target.focus();

    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  };

  if (!target || !position) {
    return null;
  }

  return ReactDOM.createPortal(
    <div
      id="on-screen-keyboard"
      ref={containerRef}
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 9999,
        width: '100%',
        maxWidth: `${KEYBOARD_WIDTH}px`,
      }}
    >
      <Keyboard
        layout={LAYOUT}
        layoutName={layoutName}
        keyboardRef={(r) => (keyboardRef.current = r)}
        display={DISPLAY}
        onChange={() => {}}
        onKeyPress={press}
        autoUseTouchEvents={true}
        useMouseEvents={true}
        preventMouseDownDefault={true}
        preventMouseUpDefault={true}
      />
    </div>,
    document.body
  );
}
