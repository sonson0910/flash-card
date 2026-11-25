import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';

export interface ReminderPhonePreviewProps {
  /** Cards the learner has right now that the reminder will count, or null when none were added. */
  readonly cardCount: number | null;
  /** The reminder time the learner picked (`HH:MM`), when known. */
  readonly time?: string | null;
  /** Days left to the goal date with the goal's name, when the learner set a date ahead. */
  readonly countdown?: { readonly days: number; readonly goal: string } | null;
  readonly today?: Date;
}

const formatDay = (date: Date, locale: string): string => {
  try { return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date); } catch { return date.toDateString(); }
};

/**
 * A phone lock screen showing the reminder as it arrives: the same title and message the
 * reminder sender uses, counted from the cards this learner actually has. Nothing is shown for a
 * value the app does not know.
 */
export function ReminderPhonePreview({ cardCount, time = null, countdown = null, today = new Date() }: ReminderPhonePreviewProps) {
  const { _, i18n } = useLingui();
  return <figure className="onb-phone crystal-chamfer" aria-label={_(msg({ context: 'onboarding.phone.label', message: 'Reminder preview' }))}>
    <div className="onb-phone-screen">
      {time && <p className="onb-phone-time">{time}</p>}
      <p className="onb-phone-date">{formatDay(today, i18n.locale)}</p>
      {cardCount !== null && cardCount > 0 && <div className="onb-phone-note sf-pop crystal-chamfer-sm">
        <span className="onb-phone-app" aria-hidden="true">{'S'}</span>
        <span className="onb-phone-note-text">
          <span className="onb-phone-note-head"><span>SonFlash</span><span><Trans {...msg({ context: 'onboarding.phone.now', message: 'now' })} /></span></span>
          <span className="onb-phone-note-body"><Trans {...msg({ context: 'onboarding.phone.body', message: '{count, plural, one {# card is ready for review.} other {# cards are ready for review.}}' })} values={{ count: cardCount }} /></span>
        </span>
      </div>}
      {countdown && countdown.days > 0 && <p className="onb-phone-countdown"><Trans {...msg({ context: 'onboarding.phone.countdown', message: '{goal} in {days, plural, one {# day} other {# days}}' })} values={countdown} /></p>}
    </div>
    <figcaption className="onb-phone-caption"><Trans {...msg({ context: 'onboarding.phone.caption', message: 'How your reminder looks when it arrives.' })} /></figcaption>
  </figure>;
}
