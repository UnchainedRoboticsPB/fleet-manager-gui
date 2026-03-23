import { css, cx } from '@emotion/css';
import { FC, type JSX } from 'react';

import { GrafanaTheme2, NavModelItem } from '@grafana/data';
import { selectors } from '@grafana/e2e-selectors';
import { reportInteraction } from '@grafana/runtime';
import { Tooltip, useStyles2, useTheme2 } from '@grafana/ui';
import unchainedIconSvg from 'img/unchained_icon.svg';
import unchainedIconWhiteSvg from 'img/unchained_icon_white.svg';

export interface BrandComponentProps {
  className?: string;
  children?: JSX.Element | JSX.Element[];
}

export const LoginLogo: FC<BrandComponentProps & { logo?: string }> = ({ className, logo }) => {
  return <img className={className} src={`${logo ? logo : unchainedIconSvg}`} alt="Unchained" />;
};

const LoginBackground: FC<BrandComponentProps> = ({ className, children }) => {
  const theme = useTheme2();

  const background = css({
    '&:before': {
      content: '""',
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 0,
      top: 0,
      background: theme.colors.background.canvas,
    },
  });

  return <div className={cx(background, className)}>{children}</div>;
};

const MenuLogo: FC<BrandComponentProps> = ({ className }) => {
  const theme = useTheme2();

  return theme.isDark ? (
    <img className={className} src={unchainedIconWhiteSvg} alt="Unchained" />
  ) : (
    <img className={className} src={unchainedIconSvg} alt="Unchained" />
  );
};

/**
 * inMegaMenuOverlay = true we just render the logo without link (used in mega menu)
 */
export function HomeLink({ homeNav, inMegaMenuOverlay }: { homeNav?: NavModelItem; inMegaMenuOverlay?: boolean }) {
  const styles = useStyles2(homeLinkStyles);

  const onHomeClicked = () => {
    reportInteraction('grafana_home_clicked');
  };

  if (inMegaMenuOverlay) {
    return (
      <div className={styles.homeLink}>
        <Branding.MenuLogo />
      </div>
    );
  }

  return (
    <Tooltip placement="bottom" content={homeNav?.text || 'Home'}>
      <a
        onClick={onHomeClicked}
        data-testid={selectors.components.Breadcrumbs.breadcrumb('Home')}
        className={styles.homeLink}
        title={homeNav?.text || 'Home'}
        href={homeNav?.url}
      >
        <Branding.MenuLogo />
      </a>
    </Tooltip>
  );
}

function homeLinkStyles(theme: GrafanaTheme2) {
  return {
    homeLink: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: theme.spacing(3),
      width: theme.spacing(3),
      margin: theme.spacing(0, 0.5),
      img: {
        maxHeight: '100%',
        maxWidth: '100%',
      },
    }),
  };
}

const LoginBoxBackground = () => {
  const theme = useTheme2();

  return css({
    background: theme.colors.background.primary,
    backgroundSize: 'cover',
  });
};

export class Branding {
  static LoginLogo = LoginLogo;
  static LoginBackground = LoginBackground;
  static MenuLogo = MenuLogo;
  static LoginBoxBackground = LoginBoxBackground;
  static AppTitle = 'Observatory';
  static LoginTitle = 'Observatory';
  static HideEdition = true;
  static GetLoginSubTitle = (): null | string => {
    return null;
  };
}
