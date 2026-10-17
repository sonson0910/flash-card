import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { CourseTargetLanguage } from './courseModel';

export interface GoalKindDefinition {
  readonly kind: string;
  readonly label: MessageDescriptor;
  /** Free-text level hint shown as a placeholder, e.g. "6.5" or "N3". Not validated server-side. */
  readonly levelHint: MessageDescriptor;
}

const en: readonly GoalKindDefinition[] = [
  { kind: 'ielts', label: msg({ id: 'course.goal.kind.ielts', message: 'IELTS' }), levelHint: msg({ id: 'course.goal.level-hint.ielts', message: 'Target band, e.g. 6.5' }) },
  { kind: 'toeic', label: msg({ id: 'course.goal.kind.toeic', message: 'TOEIC' }), levelHint: msg({ id: 'course.goal.level-hint.toeic', message: 'Target score, e.g. 800' }) },
  { kind: 'study-abroad', label: msg({ id: 'course.goal.kind.study-abroad', message: 'Study abroad' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
  { kind: 'business', label: msg({ id: 'course.goal.kind.business.en', message: 'Business English' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
  { kind: 'conversation', label: msg({ id: 'course.goal.kind.conversation', message: 'Everyday conversation' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
];

const ko: readonly GoalKindDefinition[] = [
  { kind: 'topik', label: msg({ id: 'course.goal.kind.topik', message: 'TOPIK' }), levelHint: msg({ id: 'course.goal.level-hint.topik', message: 'Target level, e.g. TOPIK II' }) },
  { kind: 'eps-topik', label: msg({ id: 'course.goal.kind.eps-topik', message: 'EPS-TOPIK (work permit)' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
  { kind: 'business', label: msg({ id: 'course.goal.kind.business.ko', message: 'Business Korean' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
  { kind: 'conversation', label: msg({ id: 'course.goal.kind.conversation', message: 'Everyday conversation' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
];

const ja: readonly GoalKindDefinition[] = [
  { kind: 'jlpt', label: msg({ id: 'course.goal.kind.jlpt', message: 'JLPT' }), levelHint: msg({ id: 'course.goal.level-hint.jlpt', message: 'Target level, e.g. N3' }) },
  { kind: 'study-abroad', label: msg({ id: 'course.goal.kind.study-abroad', message: 'Study abroad' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
  { kind: 'business', label: msg({ id: 'course.goal.kind.business.ja', message: 'Business Japanese' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
  { kind: 'conversation', label: msg({ id: 'course.goal.kind.conversation', message: 'Everyday conversation' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
];

const zh: readonly GoalKindDefinition[] = [
  { kind: 'hsk', label: msg({ id: 'course.goal.kind.hsk', message: 'HSK' }), levelHint: msg({ id: 'course.goal.level-hint.hsk', message: 'Target level, e.g. HSK 4' }) },
  { kind: 'study-abroad', label: msg({ id: 'course.goal.kind.study-abroad', message: 'Study abroad' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
  { kind: 'business', label: msg({ id: 'course.goal.kind.business.zh', message: 'Business Chinese' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
  { kind: 'conversation', label: msg({ id: 'course.goal.kind.conversation', message: 'Everyday conversation' }), levelHint: msg({ id: 'course.goal.level-hint.generic', message: 'Target level (optional)' }) },
];

const catalogs: Record<CourseTargetLanguage, readonly GoalKindDefinition[]> = { en, ko, ja, zh };

export const goalKindsFor = (targetLanguage: CourseTargetLanguage): readonly GoalKindDefinition[] => catalogs[targetLanguage];

export const goalKindLabel = (
  targetLanguage: CourseTargetLanguage,
  kind: string,
): MessageDescriptor | null => catalogs[targetLanguage].find(definition => definition.kind === kind)?.label ?? null;
