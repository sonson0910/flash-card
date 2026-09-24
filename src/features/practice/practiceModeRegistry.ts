import { msg } from '@lingui/core/macro';
import { BookOpen, Gamepad2, Languages, Mic, Zap, type LucideIcon } from 'lucide-react';
import { createWordMatchRound } from './practiceModel';
import type { CardData } from '../../types/card';

export type PracticeModeId = string;
export type PracticeModeStart = () => Promise<void>;

export type PracticeModePack = {
  readonly visibleLibraryCount: number;
};

export type PracticeMode = {
  readonly id: PracticeModeId;
  readonly label: ReturnType<typeof msg>;
  readonly description: ReturnType<typeof msg>;
  readonly duration: ReturnType<typeof msg>;
  readonly icon: LucideIcon;
  readonly isAvailable: (cards: readonly CardData[], pack: PracticeModePack) => boolean;
  readonly start?: PracticeModeStart;
  readonly unavailableLabel?: (cards: readonly CardData[], pack: PracticeModePack) => {
    readonly message: ReturnType<typeof msg>;
    readonly values: Record<string, number>;
  };
};

export const wordMatchEligibleCardCount = (cards: readonly CardData[]) => createWordMatchRound(cards, Number.MAX_SAFE_INTEGER).length;
export const isWordMatchAvailable = (cards: readonly CardData[]) => wordMatchEligibleCardCount(cards) >= 4;

const modes: PracticeMode[] = [
  {
    id: 'quiz',
    label: msg({ id: 'practice.mode.quiz.label', message: 'Quiz' }),
    description: msg({ id: 'practice.mode.quiz.description', message: 'Pick the right meaning out of four.' }),
    duration: msg({ id: 'practice.mode.quiz.duration', message: '~3 min' }),
    icon: Gamepad2,
    isAvailable: () => true,
  },
  {
    id: 'spelling',
    label: msg({ id: 'practice.mode.spelling.label', message: 'Spelling' }),
    description: msg({ id: 'practice.mode.spelling.description', message: 'Hear the word, then type it letter by letter.' }),
    duration: msg({ id: 'practice.mode.spelling.duration', message: '~4 min' }),
    icon: Languages,
    isAvailable: () => true,
  },
  {
    id: 'match',
    label: msg({ id: 'practice.mode.match.label', message: 'Word Match' }),
    description: msg({ id: 'practice.mode.match.description', message: 'Pair words and meanings in a one-minute study round.' }),
    duration: msg({ id: 'practice.mode.match.duration', message: '60 s' }),
    icon: Zap,
    isAvailable: cards => isWordMatchAvailable(cards),
    unavailableLabel: (cards) => ({
      message: msg({ id: 'practice.mode.match.unavailable', message: 'Needs 4 cards · you have {count}' }),
      values: { count: wordMatchEligibleCardCount(cards) },
    }),
  },
  {
    id: 'shadowing',
    label: msg({ id: 'practice.mode.shadowing.label', message: 'Shadowing' }),
    description: msg({ id: 'practice.mode.shadowing.description', message: 'Say the example sentence, then compare word by word.' }),
    duration: msg({ id: 'practice.mode.shadowing.duration', message: '~5 min' }),
    icon: Mic,
    isAvailable: (_cards, pack) => pack.visibleLibraryCount >= 1,
  },
  {
    id: 'story',
    label: msg({ id: 'practice.mode.story.label', message: 'Story' }),
    description: msg({ id: 'practice.mode.story.description', message: 'Read a short story woven from words you are learning.' }),
    duration: msg({ id: 'practice.mode.story.duration', message: '~6 min' }),
    icon: BookOpen,
    isAvailable: (_cards, pack) => pack.visibleLibraryCount >= 5,
    unavailableLabel: (_cards, pack) => ({
      message: msg({ id: 'practice.mode.story.unavailable', message: 'Needs 5 cards · you have {count}' }),
      values: { count: pack.visibleLibraryCount },
    }),
  },
];

export const getPracticeModes = (): readonly PracticeMode[] => modes;

export const resolvePracticeModeAction = (
  mode: PracticeMode,
  builtInActions: Partial<Record<PracticeModeId, PracticeModeStart>>,
): PracticeModeStart | undefined => mode.start ?? builtInActions[mode.id];

export const registerPracticeMode = (mode: PracticeMode): void => {
  if (modes.some(existing => existing.id === mode.id)) {
    throw new Error(`Practice mode "${mode.id}" is already registered.`);
  }
  modes.push(mode);
};
