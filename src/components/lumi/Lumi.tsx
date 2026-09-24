import { type ComponentPropsWithoutRef, type CSSProperties } from 'react';
import { useReducedMotion } from '../../lib/motionPreference';
import lumiChibi from '../../assets/lumi/lumi-chibi.webp';
import lumiHappy from '../../assets/lumi/lumi-happy.webp';
import lumiHero from '../../assets/lumi/lumi-hero.webp';
import lumiHint from '../../assets/lumi/lumi-hint.webp';
import lumiIdle from '../../assets/lumi/lumi-idle.webp';
import lumiOops from '../../assets/lumi/lumi-oops.webp';
import lumiProud from '../../assets/lumi/lumi-proud.webp';
import lumiSad from '../../assets/lumi/lumi-sad.webp';
import lumiSleepy from '../../assets/lumi/lumi-sleepy.webp';
import lumiThinking from '../../assets/lumi/lumi-thinking.webp';

export const lumiPoses = ['hero', 'idle', 'happy', 'hint', 'oops', 'proud', 'chibi', 'sleepy', 'thinking', 'sad'] as const;

export type LumiPose = typeof lumiPoses[number];

const poseSources: Record<LumiPose, string> = {
  hero: lumiHero,
  idle: lumiIdle,
  happy: lumiHappy,
  hint: lumiHint,
  oops: lumiOops,
  proud: lumiProud,
  chibi: lumiChibi,
  sleepy: lumiSleepy,
  thinking: lumiThinking,
  sad: lumiSad,
};

type LumiSharedProps = Omit<ComponentPropsWithoutRef<'img'>, 'alt' | 'aria-hidden' | 'height' | 'loading' | 'src' | 'width'> & {
  readonly pose: LumiPose;
  readonly size?: CSSProperties['width'];
  /** Marks this first visible Lumi image for eager loading. */
  readonly eager?: boolean;
};

type DecorativeLumiProps = LumiSharedProps & {
  readonly meaningful?: false;
  readonly alt?: '';
};

type MeaningfulLumiProps = LumiSharedProps & {
  readonly meaningful: true;
  readonly alt: string;
};

export type LumiProps = DecorativeLumiProps | MeaningfulLumiProps;

export function Lumi(props: LumiProps) {
  const { alt, eager = false, meaningful = false, pose, size, style, ...imageProps } = props;
  const reducedMotion = useReducedMotion();

  return (
    <img
      {...imageProps}
      src={poseSources[pose]}
      alt={meaningful ? alt : ''}
      aria-hidden={meaningful ? undefined : true}
      loading={eager ? 'eager' : 'lazy'}
      data-lumi-pose={pose}
      data-lumi-motion={reducedMotion ? 'reduced' : 'full'}
      style={{ ...style, width: size, height: size, ...(reducedMotion ? { animation: 'none' } : {}) }}
    />
  );
}
