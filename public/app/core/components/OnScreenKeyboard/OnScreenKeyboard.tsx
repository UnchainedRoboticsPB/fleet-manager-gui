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

/** The width the Satellite stylesheet is drawn for; scaled down to fit. */
const KEYBOARD_WIDTH = 1000;

/** Its natural height at that width — the five rows plus the container pad. */
const KEYBOARD_HEIGHT = 394;

/** Breathing room between the focused field and the keyboard below it. */
const GAP = 12;

/**
 * The most of the frame the keyboard may take.
 *
 * Observatory is an iframe in a Satellite page, sized `h-full w-full` into
 * whatever box the HMI author drew — there is no height to rely on. Floating
 * the keyboard beside the field assumed one: in a 645px frame it did not fit
 * below, flipped above, and was clipped a hundred pixels into Satellite's own
 * header. Pinned to the bottom and scaled to a share of the frame, it fits
 * every box, and the form is lifted clear when it would otherwise be covered.
 */
const MAX_SHARE = 0.55;

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
  const [scale, setScale] = useState(1);
  const [layoutName, setLayoutName] = useState<LayoutName>(initialLayout);
  const keyboardRef = useRef<KeyboardReactInterface | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Fit the keyboard to the frame, and lift the form out from under it.
   *
   * The lift is an offset on the form rather than a scroll, because the
   * sign-in page does not scroll — its layout is exactly the height of the
   * frame, so there is nowhere to scroll to.
   *
   * Two things this had to learn the hard way.
   *
   * `top`, not `transform`: LoginLayout animates the card in with
   * `flyInAnimation`, and a CSS animation outranks an inline style in the
   * cascade, so a transform set here computed away to the identity matrix
   * and nothing moved.
   *
   * And the body, not the form: the card sits in a container that hides its
   * overflow, so lifting the form slid it up *inside* that box and the field
   * was clipped out of sight — clear of the keyboard by measurement, and
   * invisible on screen. Moving the body takes the clipping box with it.
   */
  const place = useCallback((el: HTMLElement) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const next = Math.min(1, vw / KEYBOARD_WIDTH, (vh * MAX_SHARE) / KEYBOARD_HEIGHT);
    setScale(next);

    // Measure with any previous lift removed, or each focus would stack on
    // the last and walk the page off the top of the frame.
    const body = document.body;
    body.style.top = '';
    const covered = el.getBoundingClientRect().bottom + GAP - (vh - KEYBOARD_HEIGHT * next);
    if (covered > 0) {
      body.style.position = 'relative';
      body.style.transition = 'top 120ms ease-out';
      body.style.top = `${-Math.round(covered)}px`;
    }
  }, []);

  const close = useCallback(() => {
    document.body.style.top = '';
    setTarget(null);
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

  // Whatever happens, the page does not stay pushed up: an unmount while the
  // keyboard is open would otherwise leave the body offset for good.
  useEffect(() => () => {
    document.body.style.top = '';
  }, []);

  // The frame is resizable — an HMI author can redraw the page under us — so
  // the fit is recomputed rather than fixed at the moment of focus.
  useEffect(() => {
    if (!target) {
      return;
    }
    const onResize = () => place(target);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [target, place]);

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

  if (!target) {
    return null;
  }

  return ReactDOM.createPortal(
    // Fixed to the frame, not placed in the document: `position: fixed` in an
    // iframe is relative to that iframe's own viewport, which is exactly the
    // box the keyboard has to stay inside.
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        id="on-screen-keyboard"
        style={{
          width: KEYBOARD_WIDTH,
          // Not a flex item that shrinks: left to itself it would be squeezed
          // to the frame first and then scaled, shrinking twice and squashing
          // the keys sideways — 24px wide against 34 tall in an 820px frame.
          // The scale alone decides the size, so the keys keep their shape.
          flexShrink: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'bottom center',
          pointerEvents: 'auto',
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
      </div>
    </div>,
    document.body
  );
}
