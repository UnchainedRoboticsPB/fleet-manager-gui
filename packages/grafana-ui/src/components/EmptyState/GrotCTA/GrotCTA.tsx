import { css } from '@emotion/css';
import { SVGProps } from 'react';

import { GrafanaTheme2 } from '@grafana/data';

import { useStyles2 } from '../../../themes/ThemeContext';

import notFoundPng from './not-found-robot-icon.png';

export interface Props {
  width?: SVGProps<SVGElement>['width'];
  height?: SVGProps<SVGElement>['height'];
}

export const GrotCTA = ({ width = 'auto', height }: Props) => {
  const styles = useStyles2(getStyles);

  return <img src={notFoundPng} className={styles.svg} alt="NotFoundRobotIcon" height={height} width={width} />;
};

GrotCTA.displayName = 'GrotCTA';

const getStyles = (theme: GrafanaTheme2) => {
  return {
    svg: css({
      '#grot-cta-cactus-1, #grot-cta-cactus-2': {
        fill: theme.isDark ? '#58558c' : '#c9c5f4',
      },
    }),
  };
};
