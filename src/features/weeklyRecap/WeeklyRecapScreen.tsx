import { Check, Download, Share2 } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Lumi } from '../../components/lumi/Lumi';
import { readLumiEnabled } from '../settings/lumi-preference';
import { useTheme } from '../theme/ThemeProvider';
import { emphasisParts, weeklyRecapShortDate, type WeeklyRecapCardContent, type WeeklyRecapEmphasis } from './weeklyRecapCard';
import {
  WEEKLY_RECAP_CAPTION_MAX_LENGTH,
  type WeeklyRecapSelection,
  type WeeklyRecapSelectionKey,
} from './weeklyRecapSelection';
import type { WeeklyRecapShareOutcome } from './weeklyRecapShare';

export interface WeeklyRecapScreenActions {
  toggleSelection(key: WeeklyRecapSelectionKey): void;
  setCaption(value: string): void;
  share(): void;
  download(): void;
}

/** The controls' headline and notes, derived from the same week as the card. */
export interface WeeklyRecapIntro {
  /** This week beats the best complete week: "so far" when `since` is null. */
  readonly bestWeek: { readonly since: string | null } | null;
  readonly aheadOfLastWeek: number | null;
  /** "Weekly word counts started on {date}", only for a week that is not fully counted. */
  readonly countedSince: string | null;
}

export interface WeeklyRecapScreenProps {
  readonly content: WeeklyRecapCardContent;
  readonly intro: WeeklyRecapIntro;
  readonly dateRangeLabel: string;
  readonly selection: WeeklyRecapSelection;
  /** The toggles that have something to show. */
  readonly selectionKeys: readonly WeeklyRecapSelectionKey[];
  /** The hero shows XP until words are counted for this course. */
  readonly heroIsXp: boolean;
  readonly caption: string;
  readonly isBusy: boolean;
  readonly lastOutcome: WeeklyRecapShareOutcome | null;
  readonly exportError: boolean;
  readonly actions: WeeklyRecapScreenActions;
}

const selectionCopy: Record<WeeklyRecapSelectionKey, ReturnType<typeof msg>> = {
  words: msg({ id: 'weeklyRecap.toggle.words', message: 'Words learned' }),
  streak: msg({ id: 'weeklyRecap.toggle.streak', message: 'Streak' }),
  recall: msg({ id: 'weeklyRecap.toggle.recall', message: 'Recall' }),
  wordOfWeek: msg({ id: 'weeklyRecap.toggle.word-of-week', message: 'Word of the week' }),
  heatmap: msg({ id: 'weeklyRecap.toggle.heat', message: 'Heatmap' }),
};
const xpToggle = msg({ id: 'weeklyRecap.toggle.total-xp', message: 'Total XP' });

const outcomeCopy: Record<WeeklyRecapShareOutcome, ReturnType<typeof msg>> = {
  shared: msg({ id: 'weeklyRecap.outcome.shared', message: 'Shared.' }),
  copied: msg({ id: 'weeklyRecap.outcome.copied', message: 'Copied to your clipboard.' }),
  downloaded: msg({ id: 'weeklyRecap.outcome.downloaded', message: 'Downloaded.' }),
  failed: msg({ id: 'weeklyRecap.outcome.failed', message: 'Sharing was cancelled.' }),
};

export const weeklyRecapCopy = {
  weeklyRecap: msg({ id: 'weeklyRecap.kicker', message: 'Weekly recap' }),
  title: msg({ id: 'weeklyRecap.dialog.title', message: 'Your weekly recap' }),
  dailyXp: msg({ id: 'weeklyRecap.heatmap.week-label', message: 'Daily XP, Monday to Sunday' }),
  privacy: msg({ id: 'weeklyRecap.privacy', message: 'The image includes the selected metrics and your caption. Private words are never added automatically.' }),
};

const Emphasis = ({ parts }: { readonly parts: WeeklyRecapEmphasis }) =>
  <>{parts.before}{parts.em && <em>{parts.em}</em>}{parts.after}</>;

/** The board's check mark (AnimeWeeklyRecap toggles). */
const BoardCheck = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

/** The board's download glyph: an arrow onto a line. */
const BoardDownload = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>;

/** Hero, chips, word of the week and heat: the same content in both families, styled per family. */
function WeeklyRecapCardBody({ content }: { readonly content: WeeklyRecapCardContent }) {
  const { _ } = useLingui();
  return <>
    {content.hero && (content.hero.value === null
      ? <p className="weekly-recap-card__hero-note" data-hero="none-yet"><Emphasis parts={content.hero.label} /></p>
      : <div className="weekly-recap-card__hero-metric">
        <strong>{content.hero.value}</strong>
        <span><Emphasis parts={content.hero.label} /></span>
      </div>)}
    {content.chips.length > 0 && <dl className="weekly-recap-card__metrics">
      {content.chips.map(chip => <div key={chip.key} data-chip={chip.key}><dt>{chip.label}</dt><dd>{chip.value}</dd></div>)}
    </dl>}
    {content.wordOfWeek && <div className="weekly-recap-card__word">
      <span className="weekly-recap-card__word-label">{content.wordOfWeek.label}</span>
      <strong className="weekly-recap-card__word-value">{content.wordOfWeek.word}</strong>
      <span className="weekly-recap-card__word-detail">{content.wordOfWeek.detail}</span>
    </div>}
    {content.heatmap && <div className="weekly-recap-card__heatmap">
      <div className="weekly-recap-card__heatmap-grid" role="list" aria-label={_(weeklyRecapCopy.dailyXp)}>
        {content.heatmap.map(day => <div key={day.dateKey} role="listitem" className="weekly-recap-card__heatmap-day">
          <span role="img" className="weekly-recap-card__heatmap-cell" data-level={day.level} data-future={day.future ? 'true' : undefined} style={day.future ? undefined : { backgroundColor: `var(--weekly-recap-heat-${day.level})` }} title={day.label} aria-label={day.label} />
          <small aria-hidden="true">{day.initial}</small>
        </div>)}
      </div>
    </div>}
  </>;
}

/**
 * AnimeWeeklyRecap's card: a figure whose rim layer (a conic tier rim behind a chamfer clip) shows
 * 3px around the face; the face carries the beam, the header, the chibi Lumi and the content, and
 * the caption sits in the board's footer slot.
 */
function CrystalWeeklyRecapCard({ content, dateRangeLabel, caption }: { readonly content: WeeklyRecapCardContent; readonly dateRangeLabel: string; readonly caption: string }) {
  const { _ } = useLingui();
  const showLumi = readLumiEnabled();
  return <section className={`weekly-recap-card weekly-recap-card--crystal${showLumi ? ' weekly-recap-card--with-companion' : ''}`} aria-label={_(weeklyRecapCopy.title)}>
    <span className="weekly-recap-card__rim" aria-hidden="true"><span className="weekly-recap-card__rim-spin" /></span>
    <div className="weekly-recap-card__face">
      <span className="weekly-recap-card__beam" aria-hidden="true" />
      <header className="weekly-recap-card__header">
        <span className="weekly-recap-card__brand-star crystal-star-art" aria-hidden="true" />
        <p className="weekly-recap-card__heading">
          <span className="weekly-recap-card__kicker">{content.kicker}</span>{' '}
          <span className="weekly-recap-card__heading-sep" aria-hidden="true">//</span>{' '}
          <span className="weekly-recap-card__range">{dateRangeLabel}</span>
        </p>
      </header>
      {showLumi && <span className="weekly-recap-card__companion" aria-hidden="true"><Lumi pose="proud" size="100%" /></span>}
      {content.empty !== null ? <div className="weekly-recap-card__empty">{content.empty}</div> : <>
        <WeeklyRecapCardBody content={content} />
        {content.garden && <div className="weekly-recap-card__bloom">
          <p className="weekly-recap-card__bloom-label">{content.garden.label}</p>
          <div className="weekly-recap-card__bloom-cells">
            {content.garden.cells.map(cell => <div key={cell.key} className="weekly-recap-card__bloom-cell" data-tier={cell.key}>
              <div className="weekly-recap-card__bloom-face">
                {/* The board names each cell by its tier; the tier the words came from is read out, not drawn. */}
                <span className="weekly-recap-card__bloom-grade"><span className="sr-only">{cell.from} → </span><span data-grade="to">{cell.to}</span></span>
                <strong>{cell.count}</strong>
              </div>
            </div>)}
          </div>
        </div>}
      </>}
      {caption && <p className="weekly-recap-card__range weekly-recap-card__caption">{caption}</p>}
    </div>
  </section>;
}

function WeeklyRecapCard({ content, dateRangeLabel, caption }: { readonly content: WeeklyRecapCardContent; readonly dateRangeLabel: string; readonly caption: string }) {
  const { _ } = useLingui();
  return <section className="weekly-recap-card" aria-label={_(weeklyRecapCopy.title)}>
    <header className="weekly-recap-card__header">
      <span className="weekly-recap-card__brand-mark" aria-hidden="true">S</span>
      <p className="weekly-recap-card__kicker">{content.kicker}</p>
      <p className="weekly-recap-card__range">{dateRangeLabel}</p>
    </header>

    {content.empty !== null ? <div className="weekly-recap-card__empty">{content.empty}</div> : <WeeklyRecapCardBody content={content} />}
    {caption && <p className="weekly-recap-card__range weekly-recap-card__caption">{caption}</p>}
  </section>;
}

const headlineCopy = {
  week: msg({ id: 'weeklyRecap.controls.title', message: 'Your week <0>so far.</0>' }),
  best: msg({ id: 'weeklyRecap.controls.best-week', message: 'Your best week <0>so far.</0>' }),
  bestSince: msg({ id: 'weeklyRecap.controls.best-week-since', message: 'Your best week <0>since {date}.</0>' }),
};

const headlineFor = (bestWeek: WeeklyRecapIntro['bestWeek'], locale: string) => {
  if (!bestWeek) return { descriptor: headlineCopy.week, values: {} };
  if (bestWeek.since === null) return { descriptor: headlineCopy.best, values: {} };
  return { descriptor: headlineCopy.bestSince, values: { date: weeklyRecapShortDate(bestWeek.since, locale) } };
};

function IntroHeadline({ bestWeek, locale }: { readonly bestWeek: WeeklyRecapIntro['bestWeek']; readonly locale: string }) {
  const { descriptor, values } = headlineFor(bestWeek, locale);
  return <Trans {...descriptor} values={values} components={{ 0: <em /> }} />;
}

/**
 * The board sets the headline as two clipped-gradient runs, each with its own shadow: the plain words
 * in metal, then a line break and the emphasised words in crimson. The plain run keeps its trailing
 * space so the heading still reads as one sentence.
 */
function CrystalIntroHeadline({ bestWeek, locale }: { readonly bestWeek: WeeklyRecapIntro['bestWeek']; readonly locale: string }) {
  const { _ } = useLingui();
  const { descriptor, values } = headlineFor(bestWeek, locale);
  const parts = emphasisParts(_({ ...descriptor, values }));
  return <>
    {parts.before && <span className="weekly-recap-controls__headline-metal">{parts.before}</span>}
    {parts.em && <>{parts.before && <br />}<em>{parts.em}</em></>}
    {parts.after && <span className="weekly-recap-controls__headline-metal">{parts.after}</span>}
  </>;
}

export function WeeklyRecapScreen({
  content, intro, dateRangeLabel, selection, selectionKeys, heroIsXp, caption, isBusy, lastOutcome, exportError, actions,
}: WeeklyRecapScreenProps) {
  const { _, i18n: activeI18n } = useLingui();
  const isCrystal = useTheme().family === 'crystal';
  const locale = activeI18n.locale || 'en';
  const shareLabel = <Trans {...msg({ context: 'weeklyRecap.action.share', message: 'Share' })} />;
  const downloadLabel = <Trans {...msg({ context: 'weeklyRecap.action.download', message: 'Download PNG' })} />;
  return <div className="weekly-recap-screen" data-family={isCrystal ? 'crystal' : 'classic'}>
    {isCrystal
      ? <div className="weekly-recap-stage">
        <span className="weekly-recap-stage__wings crystal-wing-art" aria-hidden="true" />
        <span className="weekly-recap-stage__back" aria-hidden="true" />
        <CrystalWeeklyRecapCard content={content} dateRangeLabel={dateRangeLabel} caption={caption.trim()} />
      </div>
      : <WeeklyRecapCard content={content} dateRangeLabel={dateRangeLabel} caption={caption.trim()} />}

    <section className="weekly-recap-controls">
      <header className="weekly-recap-controls__intro">
        <p className="weekly-recap-controls__kicker"><Trans {...msg({ id: 'weeklyRecap.controls.kicker', message: 'Weekly recap <0/> Ready to share' })} components={{ 0: <span className="weekly-recap-controls__kicker-separator" aria-hidden="true" /> }} /></p>
        <h1>{isCrystal ? <CrystalIntroHeadline bestWeek={intro.bestWeek} locale={locale} /> : <IntroHeadline bestWeek={intro.bestWeek} locale={locale} />}</h1>
        {intro.aheadOfLastWeek !== null && intro.aheadOfLastWeek > 0 && <p className="weekly-recap-controls__lead">
          <Trans {...msg({ id: 'weeklyRecap.controls.ahead', message: '<0>+{words, plural, one {# word} other {# words}}</0> compared with last week.' })} values={{ words: intro.aheadOfLastWeek }} components={{ 0: <strong /> }} />
        </p>}
      </header>
      {intro.countedSince && <p className="weekly-recap-controls__unavailable">
        <Trans {...msg({ id: 'weeklyRecap.counted-since', message: 'Weekly word counts started on {date}.' })} values={{ date: weeklyRecapShortDate(intro.countedSince, locale) }} />
      </p>}

      {selectionKeys.length > 0 && <fieldset className="weekly-recap-controls__selection">
        <legend><Trans {...msg({ context: 'weeklyRecap.selection.legend', message: 'Show on the card' })} /></legend>
        <div>{selectionKeys.map(key => <label key={key} className={selection[key] ? 'is-selected' : undefined}>
          <input type="checkbox" checked={selection[key]} onChange={() => actions.toggleSelection(key)} data-selection-key={key} />
          {isCrystal
            // The board skews the toggle and turns its label back upright.
            ? <span className="weekly-recap-controls__toggle-label">{selection[key] && <BoardCheck />}{_(key === 'words' && heroIsXp ? xpToggle : selectionCopy[key])}</span>
            : <>{selection[key] && <Check size={13} strokeWidth={2.6} aria-hidden="true" />}{_(key === 'words' && heroIsXp ? xpToggle : selectionCopy[key])}</>}
        </label>)}</div>
      </fieldset>}

      <div className="weekly-recap-controls__caption">
        <label htmlFor="weekly-recap-caption"><Trans {...msg({ context: 'weeklyRecap.caption.label', message: 'Caption' })} /></label>
        <div className="weekly-recap-controls__caption-box">
          <textarea id="weekly-recap-caption" value={caption} maxLength={WEEKLY_RECAP_CAPTION_MAX_LENGTH} onChange={event => actions.setCaption(event.target.value)} rows={3} />
          <span>{caption.length} / {WEEKLY_RECAP_CAPTION_MAX_LENGTH}</span>
        </div>
      </div>

      <p className="weekly-recap-controls__privacy">{_(weeklyRecapCopy.privacy)}</p>
      {lastOutcome && !exportError && <p role="status" aria-live="polite" className="weekly-recap-controls__outcome">{_(outcomeCopy[lastOutcome])}</p>}
      {exportError && <p role="alert" className="weekly-recap-controls__error"><Trans {...msg({ context: 'weeklyRecap.export-error', message: 'Could not create the image. Please try again.' })} /></p>}

      <div className="weekly-recap-controls__actions">
        {isCrystal
          // Skewed board buttons: the label span turns the text back upright; the shine band rests at the left edge.
          ? <>
            <button type="button" onClick={actions.share} disabled={isBusy} className="brand-action"><span className="weekly-recap-controls__share-shine" aria-hidden="true" /><span className="weekly-recap-controls__action-label">{shareLabel}</span></button>
            <button type="button" onClick={actions.download} disabled={isBusy}><span className="weekly-recap-controls__action-label"><BoardDownload />{downloadLabel}</span></button>
          </>
          : <>
            <button type="button" onClick={actions.share} disabled={isBusy} className="brand-action sf-press"><Share2 size={16} aria-hidden="true" />{shareLabel}</button>
            <button type="button" onClick={actions.download} disabled={isBusy}><Download size={16} aria-hidden="true" />{downloadLabel}</button>
          </>}
      </div>
    </section>
  </div>;
}
