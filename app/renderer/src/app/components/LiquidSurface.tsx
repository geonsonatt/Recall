import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

type LiquidSurfaceTone = 'panel' | 'chrome' | 'pill';

interface LiquidSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  padding?: string;
  radius?: number;
  tone?: LiquidSurfaceTone;
}

type ToneConfig = {
  cornerRadius: number;
  padding: string;
  width: CSSProperties['width'];
};

const toneConfigs: Record<LiquidSurfaceTone, ToneConfig> = {
  panel: {
    cornerRadius: 12,
    padding: '12px',
    width: '100%',
  },
  chrome: {
    cornerRadius: 12,
    padding: '10px 14px',
    width: '100%',
  },
  pill: {
    cornerRadius: 999,
    padding: '6px',
    width: 'auto',
  },
};

function joinClassNames(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function LiquidSurface({
  children,
  className,
  style,
  padding,
  radius,
  tone = 'panel',
  ...rest
}: LiquidSurfaceProps) {
  const toneConfig = toneConfigs[tone];
  const surfaceStyle: CSSProperties = {
    width: toneConfig.width,
    borderRadius: radius ?? toneConfig.cornerRadius,
    padding: padding ?? toneConfig.padding,
  };

  return (
    <div className={joinClassNames('liquid-surface-wrap', className)} style={style} {...rest}>
      <div
        className={joinClassNames('liquid-surface', `liquid-surface-${tone}`)}
        style={surfaceStyle}
      >
        <div className="liquid-surface-content">{children}</div>
      </div>
    </div>
  );
}
