import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import type { I18n } from '@lingui/core';
import { useEffect } from 'react';
import type { Course, CourseGoal, CourseTargetLanguage } from './courseModel';
import { goalKindLabel } from './courseGoalCatalog';
import {
  NATIVE_ENDONYM, NATIVE_LANGUAGE_LABEL, TARGET_ENDONYM, TARGET_GLYPH, TARGET_LANGUAGE_LABEL,
} from './courseLanguageLabels';
import { loadScriptFont, type ScriptFont } from '../theme/loadThemeAssets';
import { useTheme } from '../theme/ThemeProvider';
import './course-surfaces.css';

type Translate = I18n['_'];

/** The course's first active goal, or its first goal when every goal is paused or completed. */
export const primaryGoal = (course: Course): CourseGoal | null =>
  course.goals.find(goal => goal.status === 'active') ?? course.goals[0] ?? null;

/**
 * "IELTS 7.0" or "TOPIK II": the goal's label and level, without repeating the label when the
 * learner already typed it into the level.
 */
export const goalSummaryText = (course: Course, goal: CourseGoal | null, _: Translate): string | null => {
  if (!goal) return null;
  const descriptor = goalKindLabel(course.targetLanguage, goal.kind);
  const label = descriptor ? _(descriptor) : goal.kind;
  const level = goal.level?.trim();
  if (!level) return label;
  return level.toLocaleLowerCase().startsWith(label.toLocaleLowerCase()) ? level : `${label} ${level}`;
};

/** The UI-language name of a course language, or null when it reads the same as the endonym. */
export const translatedTargetName = (language: CourseTargetLanguage, _: Translate): string | null => {
  const name = _(TARGET_LANGUAGE_LABEL[language]);
  return name === TARGET_ENDONYM[language] ? null : name;
};

const COURSE_SCRIPT_FONT: Readonly<Partial<Record<CourseTargetLanguage, ScriptFont>>> = { ko: 'ko', ja: 'ja', zh: 'zh-Hans' };

/**
 * Classic sets course names and tile glyphs in their script's Noto Sans face (LangCourses); this loads the
 * app's own subsets of those faces for the given course languages. Crystal keeps its display face.
 */
export function useCourseScriptFonts(languages: readonly CourseTargetLanguage[]) {
  const { family } = useTheme();
  const scripts = [...new Set(languages.flatMap(language => COURSE_SCRIPT_FONT[language] ?? []))].sort().join(',');
  useEffect(() => {
    if (family === 'crystal' || !scripts) return;
    for (const script of scripts.split(',') as ScriptFont[]) void loadScriptFont(script).catch(() => undefined);
  }, [family, scripts]);
}

/** The language's glyph on its own coloured tile; decorative, since the name always sits beside it. */
export function CourseTile({ language, className = '' }: { readonly language: CourseTargetLanguage; readonly className?: string }) {
  useCourseScriptFonts([language]);
  return <span className={`course-tile crystal-chamfer-sm ${className}`} data-course-language={language} lang={language} aria-hidden="true">
    {TARGET_GLYPH[language]}
  </span>;
}

/** "from Tiếng Việt", with the translated name for screen readers when it differs. */
export function CourseNativeLine({ course }: { readonly course: Course }) {
  const { _ } = useLingui();
  const endonym = NATIVE_ENDONYM[course.nativeLanguage];
  const translated = _(NATIVE_LANGUAGE_LABEL[course.nativeLanguage]);
  return <Trans {...msg({ context: 'course.native-line', message: 'from {language}' })}
    values={{ language: <span lang={course.nativeLanguage}>{endonym}{translated !== endonym && <span className="sr-only"> ({translated})</span>}</span> }} />;
}

/** Due cards as a pill; nothing while the count is unknown, so no number is ever guessed. */
export function CourseDuePill({ count, active = false }: { readonly count: number | undefined; readonly active?: boolean }) {
  if (count === undefined) return null;
  return <span className="course-due-pill" data-active={active}>
    <Trans {...msg({ context: 'course.due-count', message: '{count} due' })} values={{ count }} />
  </span>;
}
