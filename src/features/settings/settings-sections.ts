/**
 * The settings sections in menu order. Each id is also the value of the
 * `section` URL parameter (`?view=settings&section=reminders`), so a section
 * listed here can be linked to from anywhere in the shell and survives
 * browser back and forward.
 *
 * Adding a section: append its id here, then give it a menu entry (`MENU`),
 * a label (`MenuLabel`) and a render branch in `settings-screen.tsx`.
 * This module stays free of React and copy so the navigation hook can read
 * section ids without loading the settings chunk.
 */
export const SETTINGS_SECTIONS = ['appearance', 'language', 'reminders', 'sounds', 'files', 'data'] as const;
export type SettingsSectionId = typeof SETTINGS_SECTIONS[number];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'appearance';

export const isSettingsSectionId = (value: unknown): value is SettingsSectionId => (
  typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value)
);

/** Unknown or missing values open the default section. */
export const readSettingsSection = (value: string | null | undefined): SettingsSectionId => (
  isSettingsSectionId(value) ? value : DEFAULT_SETTINGS_SECTION
);
