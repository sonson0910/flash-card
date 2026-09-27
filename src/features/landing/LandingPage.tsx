import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Brain,
  Globe2,
  Headphones,
  Languages as LanguagesIcon,
  Layers,
  Menu,
  Moon,
  MousePointerClick,
  Puzzle,
  Sparkles,
  Sun,
  ToggleLeft,
  X,
} from "lucide-react";
import { useReducedMotion } from "../../lib/motionPreference";
import { useTheme } from "../theme/ThemeProvider";
import { Lumi } from "../../components/lumi/Lumi";
import { readLumiEnabled } from "../settings/lumi-preference";
import { useSetUiLocale } from "../../i18n/I18nProvider";
import { UI_LOCALE_STORAGE_KEY, type UiLocale } from "../../i18n/locales";
import deepWoodsAv1 from "../../assets/landing/deep-woods.av1.mp4";
import deepWoodsH264 from "../../assets/landing/deep-woods.h264.mp4";
import goldenHourAv1 from "../../assets/landing/golden-hour.av1.mp4";
import goldenHourH264 from "../../assets/landing/golden-hour.h264.mp4";
import quietDawnAv1 from "../../assets/landing/quiet-dawn.av1.mp4";
import quietDawnH264 from "../../assets/landing/quiet-dawn.h264.mp4";
import sonflashLogo from "../../assets/landing/sonflash-logo-80.png";
import stillWaterAv1 from "../../assets/landing/still-water.av1.mp4";
import stillWaterH264 from "../../assets/landing/still-water.h264.mp4";
import trainWindow from "../../assets/landing/train-window.webp";
import animeSpelling from "../../assets/landing/anime-spelling.jpg";
import animeImmediate from "../../assets/landing/anime-immediate.jpg";
import animeInstant from "../../assets/landing/anime-instant.jpg";
import "./landing-page.css";

interface LandingPageProps {
  readonly onEnterApp: () => void;
  readonly onOpenLibrary?: () => void;
  readonly onOpenCatalog?: () => void;
  readonly onOpenProgress?: () => void;
  readonly onSignIn?: () => void | Promise<void>;
  readonly user?: {
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
  } | null;
}

export const landingMeta = {
  title: msg({
    id: "landing.meta.title",
    message: "SonFlash — Remember words. Use them when it matters.",
  }),
  description: msg({
    id: "landing.meta.description",
    message:
      "Build an English vocabulary you can reach for with context, spaced review, and active recall.",
  }),
};

const sampleHeadword = 'serendipity';
const samplePronunciation = '/ˌser.ənˈdɪp.ə.ti/';

const videos = [
  {
    id: "golden-hour",
    label: <Trans id="landing.atmosphere.golden-hour" message="Golden Hour" />,
    av1: goldenHourAv1,
    h264: goldenHourH264,
  },
  {
    id: "still-water",
    label: <Trans id="landing.atmosphere.still-water" message="Still Water" />,
    av1: stillWaterAv1,
    h264: stillWaterH264,
  },
  {
    id: "deep-woods",
    label: <Trans id="landing.atmosphere.deep-woods" message="Deep Woods" />,
    av1: deepWoodsAv1,
    h264: deepWoodsH264,
  },
  {
    id: "quiet-dawn",
    label: <Trans id="landing.atmosphere.quiet-dawn" message="Quiet Dawn" />,
    av1: quietDawnAv1,
    h264: quietDawnH264,
  },
];

const learningFlow = [
  {
    id: "capture",
    icon: Sparkles,
    title: <Trans id="landing.flow.capture.title" message="Keep the context" />,
    description: (
      <Trans
        id="landing.flow.capture.description"
        message="Turn a word or passage into a card with its meaning, pronunciation, and example."
      />
    ),
  },
  {
    id: "read",
    icon: BookOpen,
    title: <Trans id="landing.flow.read.title" message="Read it clearly" />,
    description: (
      <Trans
        id="landing.flow.read.description"
        message="See the word in plain language before asking yourself to recall it."
      />
    ),
  },
  {
    id: "practice",
    icon: Headphones,
    title: <Trans id="landing.flow.practice.title" message="Practise recall" />,
    description: (
      <Trans
        id="landing.flow.practice.description"
        message="Review, listen, spell, or speak when that is the useful next step."
      />
    ),
  },
  {
    id: "library",
    icon: Layers,
    title: (
      <Trans
        id="landing.flow.library.title"
        message="Return when it is ready"
      />
    ),
    description: (
      <Trans
        id="landing.flow.library.description"
        message="Your cards and scheduled reviews stay together in one personal library."
      />
    ),
  },
];

const extensionFeatures = [
  {
    id: "save",
    icon: MousePointerClick,
    title: <Trans id="landing.extension.feature.save.title" message="Right-click to save" />,
    description: (
      <Trans
        id="landing.extension.feature.save.description"
        message="Select text on any website, then save it straight into your library as a flashcard with context."
      />
    ),
  },
  {
    id: "popup",
    icon: Bell,
    title: <Trans id="landing.extension.feature.popup.title" message="Check in from the toolbar" />,
    description: (
      <Trans
        id="landing.extension.feature.popup.description"
        message="Open the extension icon to see how many reviews are due, then jump back into today's session."
      />
    ),
  },
  {
    id: "opt-in",
    icon: ToggleLeft,
    title: <Trans id="landing.extension.feature.optin.title" message="Your call, site by site" />,
    description: (
      <Trans
        id="landing.extension.feature.optin.description"
        message="Turn on the optional in-page save icon only for the websites you choose."
      />
    ),
  },
];

// Mirrors the target-language packs in `src/features/languagePacks/types.ts`. Kept as static marketing
// copy rather than importing that registry, since availability here is a product-status fact (wired into
// onboarding and the course switcher) rather than the text-detection concern that module owns.
const languageOffers = [
  { id: "en", name: "English", available: true },
  { id: "ko", name: "한국어 · Korean", available: false },
  { id: "ja", name: "日本語 · Japanese", available: false },
  { id: "zh", name: "中文 · Chinese", available: false },
] as const;

const pricingRows = [
  {
    id: "reviews",
    label: <Trans id="landing.pricing.row.reviews" message="Reviews & spaced scheduling" />,
    free: <Trans id="landing.pricing.value.unlimited" message="Unlimited" />,
    pro: <Trans id="landing.pricing.value.unlimited" message="Unlimited" />,
  },
  {
    id: "manual-cards",
    label: <Trans id="landing.pricing.row.manual-cards" message="Manual flashcards" />,
    free: <Trans id="landing.pricing.value.unlimited" message="Unlimited" />,
    pro: <Trans id="landing.pricing.value.unlimited" message="Unlimited" />,
  },
  {
    id: "ai-cards",
    label: <Trans id="landing.pricing.row.ai-cards" message="AI-generated cards" />,
    free: <Trans id="landing.pricing.value.ai-free" message="30 / month" />,
    pro: <Trans id="landing.pricing.value.ai-pro" message="More each month" />,
  },
  {
    id: "extension",
    label: <Trans id="landing.pricing.row.extension" message="Chrome extension" />,
    free: <Trans id="landing.pricing.value.included" message="Included" />,
    pro: <Trans id="landing.pricing.value.included" message="Included" />,
  },
];

const pricingFaq = [
  {
    id: "free",
    question: <Trans id="landing.pricing.faq.free.question" message="Is the free plan really free?" />,
    answer: (
      <Trans
        id="landing.pricing.faq.free.answer"
        message="Yes. Reviews, manual cards, and the Chrome extension stay free with no time limit. Free includes 30 AI-generated cards each month."
      />
    ),
  },
  {
    id: "exhausted",
    question: <Trans id="landing.pricing.faq.exhausted.question" message="What happens if I use all 30 AI cards?" />,
    answer: (
      <Trans
        id="landing.pricing.faq.exhausted.answer"
        message="You can keep reviewing and add cards manually. AI generation resumes next month, or right away with Pro."
      />
    ),
  },
  {
    id: "checkout",
    question: <Trans id="landing.pricing.faq.checkout.question" message="Can I buy Pro right now?" />,
    answer: (
      <Trans
        id="landing.pricing.faq.checkout.answer"
        message="Not yet. Sign in and open Pro from your account menu to register interest — nothing is charged during the pilot."
      />
    ),
  },
];

function LocaleLinks({ compact = false }: { readonly compact?: boolean }) {
  const setUiLocale = useSetUiLocale();
  const { _ } = useLingui();
  const selectLocale = (locale: UiLocale) => {
    try {
      globalThis.localStorage?.setItem(UI_LOCALE_STORAGE_KEY, locale);
    } catch {
      /* Native navigation still follows the visible link. */
    }
    void setUiLocale(locale);
  };
  return (
    <nav
      aria-label={_(
        msg({ id: "landing.language.label", message: "Interface language" }),
      )}
      className={`flex items-center gap-1 ${compact ? "text-xs" : "text-sm font-semibold"}`}
    >
      <Globe2 size={compact ? 14 : 16} aria-hidden="true" />
      <a
        href="/"
        lang="en"
        hrefLang="en"
        onClick={() => selectLocale("en")}
        className="rounded px-2 py-1 underline-offset-4 hover:underline focus-visible:outline-2"
      >
        English
      </a>
      <span aria-hidden="true">/</span>
      <a
        href="/vi/"
        lang="vi"
        hrefLang="vi"
        onClick={() => selectLocale("vi")}
        className="rounded px-2 py-1 underline-offset-4 hover:underline focus-visible:outline-2"
      >
        Tiếng Việt
      </a>
    </nav>
  );
}

const crystalDemoWords = {
  spelling: { word: 'Spelling', ipa: '/ˈspelɪŋ/' },
  immediate: { word: 'Immediate', ipa: '/ɪˈmiːdiət/' },
  instant: { word: 'Instant', ipa: '/ˈɪnstənt/' },
} as const;

function CrystalLandingHero({ onEnterApp, onSignIn, user, showLumi }: Pick<LandingPageProps, 'onEnterApp' | 'onSignIn' | 'user'> & { readonly showLumi: boolean }) {
  const { _ } = useLingui();
  return <section className="crystal-landing-hero" aria-labelledby="landing-heading">
    <div className="crystal-copy">
      <span className="crystal-badge"><Trans id="landing.hero.crystal-badge" message="Crystal Star" /></span>
      <h1 id="landing-heading">SonFlash</h1>
      <p className="crystal-tagline"><Trans id="landing.hero.title" message="Remember words.<0/>Use them when it matters." components={{ 0: <br /> }} /></p>
      <p className="crystal-description"><Trans id="landing.hero.description" message="Build an English vocabulary you can reach for with context, spaced review, and active recall." /></p>
      <div className="crystal-actions">
        <button type="button" onClick={onEnterApp} className="crystal-primary"><Trans id="landing.hero.start" message="Start learning" /> <ArrowRight size={18} aria-hidden="true" /></button>
        {onSignIn && !user && <button type="button" onClick={() => void onSignIn()} className="crystal-secondary"><Trans id="landing.hero.sign-in" message="Sign in to sync" /></button>}
      </div>
    </div>
    <div className="crystal-card-stage" aria-label={_(msg({ id: 'landing.demo.cards.label', message: 'Sample English vocabulary cards' }))}>
      <div className="crystal-flare" aria-hidden="true" />
      <article className="crystal-demo-card crystal-demo-left" aria-hidden="true"><img src={animeSpelling} width={1000} height={667} alt="" loading="lazy" decoding="async" /><span><i><Trans id="landing.demo.grade.bud" message="Bud" /></i>{' '}<Trans id="landing.demo.tier.new" message="New" /></span><strong>{crystalDemoWords.spelling.word}</strong><small>{crystalDemoWords.spelling.ipa}</small><b><Trans id="landing.demo.meaning.spelling" message="spelling" /></b></article>
      <article className="crystal-demo-card crystal-demo-right" aria-hidden="true"><img src={animeImmediate} width={1000} height={667} alt="" loading="lazy" decoding="async" /><span><i><Trans id="landing.demo.grade.bloom" message="Bloom" /></i>{' '}<Trans id="landing.demo.tier.learning" message="Learning" /></span><strong>{crystalDemoWords.immediate.word}</strong><small>{crystalDemoWords.immediate.ipa}</small><b><Trans id="landing.demo.meaning.immediate" message="without delay" /></b></article>
      <article className="crystal-demo-card crystal-demo-main"><img src={animeInstant} width={1000} height={667} alt="" decoding="async" fetchPriority="high" /><span><i><Trans id="landing.demo.grade.star" message="Star" /></i>{' '}<Trans id="landing.demo.tier.mastered" message="Mastered" /></span><strong>{crystalDemoWords.instant.word}</strong><small>{crystalDemoWords.instant.ipa}</small><b><Trans id="landing.demo.meaning.instant" message="a moment" /></b></article>
      {showLumi && <Lumi pose="hero" eager className="crystal-hero-lumi" />}
    </div>
    <div className="crystal-ribbon" aria-hidden="true"><span><Trans id="landing.ribbon.spaced-review" message="Spaced review" /></span><span><Trans id="landing.ribbon.context-first" message="Context first" /></span><span><Trans id="landing.ribbon.learn-at-your-pace" message="Learn at your pace" /></span><span><Trans id="landing.ribbon.chrome-extension" message="Chrome extension" /></span></div>
  </section>;
}

function ClassicLandingHero({
  onEnterApp,
  onSignIn,
  user,
  showLumi,
  actionClass,
}: Pick<LandingPageProps, 'onEnterApp' | 'onSignIn' | 'user'> & {
  readonly showLumi: boolean;
  readonly actionClass: string;
}) {
  const { _ } = useLingui();
  const reduceMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(false);
  const toggleFlip = () => setFlipped((value) => !value);
  const handleFlipKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleFlip();
    }
  };
  const flipLabel = flipped
    ? _(msg({ id: 'landing.demo.flip.hide', message: 'Show the word again' }))
    : _(msg({ id: 'landing.demo.reveal-prompt', message: 'Tap to reveal the meaning' }));
  return (
    <div className="landing-hero grid flex-1 items-center gap-12 py-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,.72fr)] lg:py-10">
      <div className="landing-copy max-w-3xl">
        <p className="mb-5 inline-flex rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-1 text-sm font-bold text-[var(--sf-brand-text)]">
          <Trans
            id="landing.hero.eyebrow"
            message="English vocabulary, remembered"
          />
        </p>
        <h1
          id="landing-heading"
          className="font-serif-hero text-balance text-[clamp(3.5rem,8vw,7.6rem)] leading-[.88] tracking-[-.055em]"
        >
          <Trans
            id="landing.hero.title"
            message="Remember words.<0/>Use them when it matters."
            components={{ 0: <br /> }}
          />
        </h1>
        <p className="mt-7 max-w-xl text-pretty text-base leading-7 text-[var(--sf-text-muted)] sm:text-lg">
          <Trans
            id="landing.hero.description"
            message="Build an English vocabulary you can reach for with context, spaced review, and active recall."
          />
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onEnterApp}
            className="brand-action inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--sf-brand)] px-6 font-black text-[var(--sf-on-brand)] shadow-[var(--sf-panel-shadow)] transition hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 motion-reduce:transition-none [html[data-theme-family=crystal]_&]:crystal-chamfer"
          >
            <Trans id="landing.hero.start" message="Start learning" />
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          {onSignIn && !user && (
            <button
              type="button"
              onClick={() => void onSignIn()}
              className={actionClass}
            >
              <Trans
                id="landing.hero.sign-in"
                message="Sign in to sync"
              />
            </button>
          )}
        </div>
      </div>
      <aside
        className="landing-card relative mx-auto w-full max-w-md lg:justify-self-end"
        aria-label={_(
          msg({
            id: 'landing.demo.label',
            message: 'Sample English vocabulary card',
          }),
        )}
      >
        <div
          className="absolute -inset-8 -z-10 rounded-full bg-[color-mix(in_srgb,var(--sf-brand)_18%,transparent)] blur-3xl"
          aria-hidden="true"
        />
        {showLumi && (
          <Lumi
            pose="hero"
            className="crystal-ornament pointer-events-none absolute -bottom-12 -left-[13rem] z-10 hidden h-[420px] w-[154px] max-w-none object-contain min-[1440px]:block"
          />
        )}
        <div style={{ perspective: reduceMotion ? 'none' : '1600px' }}>
          <div
            role="button"
            tabIndex={0}
            aria-pressed={flipped}
            aria-label={flipLabel}
            data-flipped={flipped ? 'true' : undefined}
            onClick={toggleFlip}
            onKeyDown={handleFlipKeyDown}
            style={{
              position: 'relative',
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
              transition: reduceMotion ? 'none' : 'transform 640ms cubic-bezier(.2,.8,.2,1)',
            }}
            className="cursor-pointer rounded-[2rem] focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            <div
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
              className="crystal-chamfer relative overflow-hidden rounded-[2rem] border border-[var(--sf-border)] bg-[var(--sf-card-bg)] p-3 shadow-[0_28px_70px_-35px_var(--sf-shadow)]"
            >
              <div className="rounded-[1.45rem] bg-[var(--sf-surface-raised)] px-6 py-9 sm:px-8">
                <p className="text-xs font-black uppercase tracking-[.16em] text-[var(--sf-text-muted)]">
                  <Trans id="landing.demo.part-of-speech" message="Noun" />
                </p>
                <p
                  lang="en"
                  className="mt-5 font-serif-hero text-5xl leading-none tracking-tight sm:text-6xl"
                >
                  {sampleHeadword}
                </p>
                <p className="mt-3 font-mono text-sm text-[var(--sf-text-muted)]">
                  {samplePronunciation}
                </p>
                <p className="mt-8 border-t border-[var(--sf-border)] pt-5 text-center text-sm font-bold text-[var(--sf-brand-text)]">
                  <Trans id="landing.demo.reveal-prompt" message="Tap to reveal the meaning" />
                </p>
              </div>
            </div>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
              className="crystal-chamfer overflow-hidden rounded-[2rem] border border-[var(--sf-border)] bg-[var(--sf-card-bg)] p-3 shadow-[0_28px_70px_-35px_var(--sf-shadow)]"
            >
              <div className="flex h-full flex-col justify-center rounded-[1.45rem] bg-[var(--sf-surface-raised)] px-6 py-9 sm:px-8">
                <p className="font-bold">
                  <Trans
                    id="landing.demo.meaning"
                    message="a happy discovery by chance"
                  />
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--sf-text-muted)]">
                  <Trans
                    id="landing.demo.example"
                    message="Finding that little bookshop was pure serendipity."
                  />
                </p>
                <p className="mt-6 text-sm font-semibold text-[var(--sf-brand-text)]">
                  <Trans
                    id="landing.demo.caption"
                    message="One clear card, ready for the next review."
                  />
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function LandingPage({
  onEnterApp,
  onOpenLibrary,
  onOpenCatalog,
  onSignIn,
  user,
}: LandingPageProps) {
  const { _ } = useLingui();
  const [activeVideo, setActiveVideo] = useState(0);
  const { mode, family, setMode } = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const [saveData, setSaveData] = useState(false);
  const [afterFirstPaint, setAfterFirstPaint] = useState(false);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const mobileNavRef = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    setSaveData(connection?.saveData === true);
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAfterFirstPaint(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (
        mode === "dark" &&
        index === activeVideo &&
        !prefersReducedMotion &&
        !saveData
      ) {
        if (video.readyState === HTMLMediaElement.HAVE_NOTHING) video.load();
        video.play().catch(() => undefined);
      } else video.pause();
    });
  }, [activeVideo, mode, prefersReducedMotion, saveData]);
  const closeMobileNav = () => mobileNavRef.current?.removeAttribute("open");
  const showLumi = afterFirstPaint && family === "crystal" && readLumiEnabled();
  const actionClass =
    "min-h-12 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-5 font-bold text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] transition hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none [html[data-theme-family=crystal]_&]:crystal-chamfer-sm";

  return (
    <div className="landing-canvas min-h-[100svh] overflow-x-clip bg-[var(--sf-canvas)] text-[var(--sf-text)] selection:bg-[var(--sf-brand)] selection:text-[var(--sf-on-brand)]">
      <main>
        <section
          id="top"
          className="relative min-h-[100svh] overflow-hidden border-b border-[var(--sf-border)]"
          aria-labelledby="landing-heading"
        >
          <div
            className="absolute inset-0 bg-[var(--sf-canvas)]"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 opacity-0 [html.dark_&]:opacity-100"
            aria-hidden="true"
          >
            {videos.map((video, index) => (
              <video
                key={video.id}
                ref={(element) => {
                  videoRefs.current[index] = element;
                }}
                data-hero-video
                autoPlay={
                  mode === "dark" &&
                  index === activeVideo &&
                  !prefersReducedMotion &&
                  !saveData
                }
                muted
                loop
                playsInline
                preload={
                  mode === "dark" && index === activeVideo && !saveData
                    ? "metadata"
                    : "none"
                }
                className={`absolute inset-0 size-full object-cover transition-opacity duration-700 motion-reduce:transition-none ${index === activeVideo ? "opacity-70" : "opacity-0"}`}
              >
                <source
                  src={video.av1}
                  type='video/mp4; codecs="av01.0.08M.08"'
                />
                <source
                  src={video.h264}
                  type='video/mp4; codecs="avc1.640028"'
                />
              </video>
            ))}
            <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--sf-canvas)_0%,color-mix(in_srgb,var(--sf-canvas)_84%,transparent)_50%,color-mix(in_srgb,var(--sf-canvas)_30%,transparent)_100%)]" />
          </div>
          <img
            src={trainWindow}
            width={2752}
            height={1536}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            className="train-bob pointer-events-none absolute inset-0 size-full object-cover opacity-[.04] [html.dark_&]:opacity-0"
          />
          <div
            className="crystal-starfield pointer-events-none absolute inset-0 opacity-0 [html[data-theme-family=crystal]_&]:opacity-30"
            aria-hidden="true"
          />
          <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-[92rem] flex-col px-5 py-5 sm:px-8 lg:px-12">
            <header className="landing-header flex items-center justify-between gap-3">
              <a
                href="#top"
                aria-label="SonFlash"
                className="flex min-h-11 items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                <img
                  src={sonflashLogo}
                  width={36}
                  height={36}
                  alt=""
                  decoding="async"
                  fetchPriority="high"
                  className="landing-classic-mark size-9 rounded-lg object-cover"
                />
                <svg className="landing-crystal-mark" viewBox="0 0 100 100" width="36" height="36" aria-hidden="true"><path d="M50 4 62 36 96 37 69 59 78 91 50 72 22 91 31 59 4 37 38 36Z" fill="#ff5470"/><path d="M50 4 62 36 96 37 69 59 78 91 50 72Z" fill="#7a0820"/></svg>
                <span className="landing-classic-brand font-serif-hero text-2xl font-bold tracking-tight text-[var(--sf-brand-text)]">
                  <Trans id="landing.brand.plain" message="SonFlash" />
                </span>
                <span className="landing-crystal-brand" aria-hidden="true"><Trans id="landing.brand.crystal-wordmark" message="SON<0>FLASH</0>" components={{ 0: <em /> }} /></span>
              </a>
              <nav
                aria-label={_(
                  msg({
                    id: "landing.nav.label",
                    message: "Landing navigation",
                  }),
                )}
                className="hidden items-center gap-1 lg:flex"
              >
                <a
                  href="#how-it-works"
                  className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] focus-visible:outline-2"
                >
                  <Trans id="landing.nav.how-it-works" message="How it works" />
                </a>
                <button
                  type="button"
                  onClick={onOpenCatalog ?? onEnterApp}
                  className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] focus-visible:outline-2"
                >
                  <Trans id="landing.nav.curriculum" message="Curriculum" />
                </button>
                <button
                  type="button"
                  onClick={onOpenLibrary ?? onEnterApp}
                  className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] focus-visible:outline-2"
                >
                  <Trans id="landing.nav.vocabulary" message="Vocabulary" />
                </button>
                <a
                  href="#extension"
                  className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] focus-visible:outline-2"
                >
                  <Trans id="landing.nav.extension" message="Extension" />
                </a>
                <a
                  href="#languages"
                  className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] focus-visible:outline-2"
                >
                  <Trans id="landing.nav.languages" message="Languages" />
                </a>
                <a
                  href="#pricing"
                  className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] focus-visible:outline-2"
                >
                  <Trans id="landing.nav.pricing" message="Pricing & access" />
                </a>
              </nav>
              <div className="hidden items-center gap-2 md:flex">
                {family === 'crystal' && <button type="button" className="landing-theme-toggle" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} aria-label={_(msg({ id: 'shell.theme.quick-toggle', message: 'Switch light and dark mode' }))}>{mode === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}</button>}
                <LocaleLinks compact />
                {onSignIn && !user && (
                  <button
                    type="button"
                    onClick={() => void onSignIn()}
                    className="min-h-11 rounded-lg px-3 text-sm font-bold hover:text-[var(--sf-brand-text)] focus-visible:outline-2"
                  >
                    <Trans id="landing.nav.sign-in" message="Sign in" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onEnterApp}
                  className="brand-action min-h-11 rounded-xl bg-[var(--sf-brand)] px-4 text-sm font-black text-[var(--sf-on-brand)] shadow-[var(--sf-panel-shadow)] transition hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                >
                  <Trans id="landing.hero.start" message="Start learning" />
                </button>
              </div>
              <details
                ref={mobileNavRef}
                className="group relative md:hidden"
                onKeyDown={(event) => {
                  if (event.key === "Escape" && event.currentTarget.open) {
                    event.preventDefault();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary
                  aria-label={_(
                    msg({
                      id: "landing.mobile-menu.open",
                      message: "Open navigation menu",
                    }),
                  )}
                  className={`${actionClass} flex size-11 min-h-0 cursor-pointer list-none items-center justify-center p-0 [&::-webkit-details-marker]:hidden`}
                >
                  <Menu
                    size={19}
                    className="group-open:hidden"
                    aria-hidden="true"
                  />
                  <X
                    size={19}
                    className="hidden group-open:block"
                    aria-hidden="true"
                  />
                </summary>
                <nav
                  aria-label={_(
                    msg({
                      id: "landing.mobile-nav.label",
                      message: "Mobile navigation",
                    }),
                  )}
                  className="absolute right-0 top-14 z-20 flex w-64 flex-col gap-1 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3 text-[var(--sf-text)] shadow-2xl [html[data-theme-family=crystal]_&]:crystal-chamfer"
                >
                  <a
                    href="#how-it-works"
                    onClick={closeMobileNav}
                    className="rounded-xl px-4 py-3 font-bold hover:bg-[var(--sf-surface-muted)] focus-visible:outline-2"
                  >
                    <Trans
                      id="landing.nav.how-it-works"
                      message="How it works"
                    />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      closeMobileNav();
                      (onOpenCatalog ?? onEnterApp)();
                    }}
                    className="rounded-xl px-4 py-3 text-left font-bold hover:bg-[var(--sf-surface-muted)] focus-visible:outline-2"
                  >
                    <Trans id="landing.nav.curriculum" message="Curriculum" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeMobileNav();
                      (onOpenLibrary ?? onEnterApp)();
                    }}
                    className="rounded-xl px-4 py-3 text-left font-bold hover:bg-[var(--sf-surface-muted)] focus-visible:outline-2"
                  >
                    <Trans id="landing.nav.vocabulary" message="Vocabulary" />
                  </button>
                  <a
                    href="#extension"
                    onClick={closeMobileNav}
                    className="rounded-xl px-4 py-3 font-bold hover:bg-[var(--sf-surface-muted)] focus-visible:outline-2"
                  >
                    <Trans id="landing.nav.extension" message="Extension" />
                  </a>
                  <a
                    href="#languages"
                    onClick={closeMobileNav}
                    className="rounded-xl px-4 py-3 font-bold hover:bg-[var(--sf-surface-muted)] focus-visible:outline-2"
                  >
                    <Trans id="landing.nav.languages" message="Languages" />
                  </a>
                  <a
                    href="#pricing"
                    onClick={closeMobileNav}
                    className="rounded-xl px-4 py-3 font-bold hover:bg-[var(--sf-surface-muted)] focus-visible:outline-2"
                  >
                    <Trans
                      id="landing.nav.pricing"
                      message="Pricing & access"
                    />
                  </a>
                  <div className="px-2 py-2">
                    <LocaleLinks />
                  </div>
                </nav>
              </details>
            </header>
            {family === "crystal"
              ? <CrystalLandingHero onEnterApp={onEnterApp} onSignIn={onSignIn} user={user} showLumi={showLumi} />
              : <ClassicLandingHero onEnterApp={onEnterApp} onSignIn={onSignIn} user={user} showLumi={showLumi} actionClass={actionClass} />}
            <fieldset className="landing-atmospheres mb-3 border-l border-[var(--sf-border)] pl-4">
              <legend className="mb-2 text-xs font-bold text-[var(--sf-text-muted)]">
                <Trans
                  id="landing.hero.atmosphere"
                  message="Choose an atmosphere"
                />
              </legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {videos.map((video, index) => (
                  <button
                    key={video.id}
                    type="button"
                    aria-pressed={index === activeVideo}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => setActiveVideo(index)}
                    className={`min-h-11 border-b px-1 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none ${index === activeVideo ? "border-[var(--sf-brand)] text-[var(--sf-brand-text)]" : "border-transparent text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]"}`}
                  >
                    {video.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </section>
        <section
          id="how-it-works"
          aria-labelledby="features-heading"
          className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28 lg:px-12"
        >
          <div className="grid gap-12 lg:grid-cols-[minmax(15rem,.7fr)_minmax(0,1.3fr)] lg:gap-24">
            <header>
              <p className="text-sm font-bold text-[var(--sf-brand-text)]">
                <Trans
                  id="landing.features.eyebrow"
                  message="A calmer learning loop"
                />
              </p>
              <h2
                id="features-heading"
                className="mt-4 max-w-md text-balance text-4xl font-black tracking-tight sm:text-5xl"
              >
                <Trans
                  id="landing.features.title"
                  message="Keep the words you meet."
                />
              </h2>
              <p className="mt-5 max-w-md leading-7 text-[var(--sf-text-muted)]">
                <Trans
                  id="landing.features.description"
                  message="SonFlash keeps context, recall, and the next useful review close together."
                />
              </p>
            </header>
            <ol className="border-t border-[var(--sf-border)]">
              {learningFlow.map((item, index) => {
                const Icon = item.icon;
                return (
                  <li
                    key={item.id}
                    className="grid gap-4 border-b border-[var(--sf-border)] py-7 sm:grid-cols-[3rem_minmax(0,1fr)]"
                  >
                    <div
                      className="flex size-11 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--sf-brand)_12%,transparent)] text-[var(--sf-brand-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                      aria-hidden="true"
                    >
                      <Icon size={19} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[var(--sf-brand-text)]">
                        0{index + 1}
                      </p>
                      <h3 className="mt-2 text-2xl font-black tracking-tight">
                        {item.title}
                      </h3>
                      <p className="mt-2 max-w-2xl leading-7 text-[var(--sf-text-muted)]">
                        {item.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
        <section
          id="extension"
          aria-labelledby="extension-heading"
          className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28 lg:px-12"
        >
          <div className="grid gap-12 lg:grid-cols-[minmax(15rem,.7fr)_minmax(0,1.3fr)] lg:gap-24">
            <header>
              <div
                className="flex size-12 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--sf-brand)_12%,transparent)] text-[var(--sf-brand-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                aria-hidden="true"
              >
                <Puzzle size={21} />
              </div>
              <p className="mt-6 text-sm font-bold text-[var(--sf-brand-text)]">
                <Trans id="landing.extension.eyebrow" message="Save from anywhere" />
              </p>
              <h2
                id="extension-heading"
                className="mt-4 max-w-md text-balance text-4xl font-black tracking-tight sm:text-5xl"
              >
                <Trans id="landing.extension.title" message="Learn from the page you're already on." />
              </h2>
              <p className="mt-5 max-w-md leading-7 text-[var(--sf-text-muted)]">
                <Trans
                  id="landing.extension.description"
                  message="The SonFlash Chrome extension turns any selected word or passage into a flashcard without leaving the page."
                />
              </p>
            </header>
            <ol className="border-t border-[var(--sf-border)]">
              {extensionFeatures.map((item, index) => {
                const Icon = item.icon;
                return (
                  <li
                    key={item.id}
                    className="grid gap-4 border-b border-[var(--sf-border)] py-7 sm:grid-cols-[3rem_minmax(0,1fr)]"
                  >
                    <div
                      className="flex size-11 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--sf-brand)_12%,transparent)] text-[var(--sf-brand-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                      aria-hidden="true"
                    >
                      <Icon size={19} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[var(--sf-brand-text)]">0{index + 1}</p>
                      <h3 className="mt-2 text-2xl font-black tracking-tight">{item.title}</h3>
                      <p className="mt-2 max-w-2xl leading-7 text-[var(--sf-text-muted)]">{item.description}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
        <section
          id="languages"
          aria-labelledby="languages-heading"
          className="border-t border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-5 py-16 sm:px-8 lg:px-12"
        >
          <div className="mx-auto max-w-3xl">
            <div
              className="flex size-12 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--sf-brand)_12%,transparent)] text-[var(--sf-brand-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
              aria-hidden="true"
            >
              <LanguagesIcon size={21} />
            </div>
            <p className="mt-6 text-sm font-bold text-[var(--sf-brand-text)]">
              <Trans id="landing.languages.eyebrow" message="Where SonFlash is headed" />
            </p>
            <h2
              id="languages-heading"
              className="mt-3 text-3xl font-black tracking-tight sm:text-4xl"
            >
              <Trans id="landing.languages.title" message="English today. More languages on the way." />
            </h2>
            <p className="mt-4 leading-7 text-[var(--sf-text-muted)]">
              <Trans
                id="landing.languages.description"
                message="SonFlash currently teaches English vocabulary, with meanings shown in English or Vietnamese. These vocabulary packs are in development and are not yet available to switch to."
              />
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {languageOffers.map(pack => (
                <li
                  key={pack.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-3 text-sm [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                >
                  <span className="font-semibold">
                    {pack.id === "en" && <Trans id="landing.languages.pack.english" message="English" />}
                    {pack.id === "ko" && <Trans id="landing.languages.pack.korean" message="한국어 · Korean" />}
                    {pack.id === "ja" && <Trans id="landing.languages.pack.japanese" message="日本語 · Japanese" />}
                    {pack.id === "zh" && <Trans id="landing.languages.pack.chinese" message="中文 · Chinese" />}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${pack.available ? "bg-[color-mix(in_srgb,var(--sf-brand)_12%,transparent)] text-[var(--sf-brand-text)]" : "bg-[var(--sf-surface-muted)] text-[var(--sf-text-muted)]"}`}
                  >
                    {pack.available
                      ? <Trans id="landing.languages.status.available" message="Available now" />
                      : <Trans id="landing.languages.status.in-progress" message="In progress" />}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section
          aria-labelledby="methods-heading"
          className="border-y border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-5 py-20 sm:px-8 sm:py-28 lg:px-12"
        >
          <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,.85fr)_minmax(20rem,1.15fr)]">
            <div>
              <div
                className="flex size-12 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--sf-brand)_12%,transparent)] text-[var(--sf-brand-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                aria-hidden="true"
              >
                <Brain size={21} />
              </div>
              <h2
                id="methods-heading"
                className="mt-6 text-balance text-4xl font-black tracking-tight sm:text-5xl"
              >
                <Trans
                  id="landing.methods.title"
                  message="Review what is ready."
                />
              </h2>
              <p className="mt-5 max-w-xl leading-7 text-[var(--sf-text-muted)]">
                <Trans
                  id="landing.methods.description"
                  message="Your feedback helps plan a useful next review with FSRS scheduling."
                />
              </p>
              <dl className="mt-8 space-y-4 border-l border-[var(--sf-brand)] pl-5">
                <div>
                  <dt className="font-bold">
                    <Trans
                      id="landing.methods.context.title"
                      message="See the meaning in context"
                    />
                  </dt>
                  <dd className="mt-1 text-sm leading-6 text-[var(--sf-text-muted)]">
                    <Trans
                      id="landing.methods.context.description"
                      message="A clear card gives each word room to make sense."
                    />
                  </dd>
                </div>
                <div>
                  <dt className="font-bold">
                    <Trans
                      id="landing.methods.recall.title"
                      message="Judge your recall honestly"
                    />
                  </dt>
                  <dd className="mt-1 text-sm leading-6 text-[var(--sf-text-muted)]">
                    <Trans
                      id="landing.methods.recall.description"
                      message="Four familiar ratings keep the choice quick."
                    />
                  </dd>
                </div>
              </dl>
            </div>
            <div className="crystal-chamfer rounded-[2rem] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-7 shadow-[var(--sf-panel-shadow)]">
              <p className="text-sm font-bold text-[var(--sf-brand-text)]">
                <Trans
                  id="landing.methods.preview.caption"
                  message="Built for the words you actually meet."
                />
              </p>
              <p className="mt-4 font-serif-hero text-4xl leading-tight">
                <Trans
                  id="landing.methods.preview.quote"
                  message="A vocabulary is useful when you can reach for it."
                />
              </p>
              <button
                type="button"
                onClick={onOpenLibrary ?? onEnterApp}
                className={`${actionClass} mt-7 inline-flex items-center gap-2`}
              >
                <Trans
                  id="landing.methods.open-library"
                  message="Open your library"
                />
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
        <section
          id="pricing"
          aria-labelledby="pricing-heading"
          className="border-t border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-5 py-16 sm:px-8 lg:px-12"
        >
          <div className="mx-auto max-w-5xl">
            <p className="text-sm font-bold text-[var(--sf-brand-text)]">
              <Trans id="landing.pricing.eyebrow" message="Free to start, Pro when you want more" />
            </p>
            <h2
              id="pricing-heading"
              className="mt-3 text-3xl font-black tracking-tight sm:text-4xl"
            >
              <Trans id="landing.pricing.title" message="Pricing & access" />
            </h2>
            <div className="mt-8 grid gap-8 lg:grid-cols-2">
              <div className="rounded-[2rem] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 shadow-[var(--sf-panel-shadow)] sm:p-8 [html[data-theme-family=crystal]_&]:crystal-chamfer">
                <div className="grid grid-cols-3 items-end gap-2 border-b border-[var(--sf-border)] pb-3">
                  <span className="font-serif-hero text-lg"><Trans id="landing.pricing.free-vs-pro.title" message="Free vs Pro" /></span>
                  <span className="text-center text-xs font-bold text-[var(--sf-text-muted)]"><Trans id="landing.pricing.free-vs-pro.free" message="Free" /></span>
                  <span className="text-center text-xs font-bold text-[var(--sf-brand-text)]"><Trans id="landing.pricing.free-vs-pro.pro" message="Pro" /></span>
                </div>
                {pricingRows.map(row => (
                  <div key={row.id} className="grid grid-cols-3 items-center gap-2 border-b border-[var(--sf-border)] py-3 text-sm last:border-b-0">
                    <span>{row.label}</span>
                    <span className="text-center font-mono text-xs text-[var(--sf-text-muted)]">{row.free}</span>
                    <span className="text-center font-mono text-xs font-semibold">{row.pro}</span>
                  </div>
                ))}
                <p className="mt-5 font-serif-hero text-2xl">
                  <Trans id="landing.pricing.price" message="Pro is 79,000 ₫ (about US$7.99)." />
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--sf-text-muted)]">
                  <Trans
                    id="landing.pricing.purchase-note"
                    message="Registering your interest does not charge you. Purchases are not open yet — we will follow up by email when they are."
                  />
                </p>
              </div>
              <div>
                <h3 className="text-xl font-black tracking-tight"><Trans id="landing.pricing.faq.title" message="Questions" /></h3>
                <dl className="mt-4 space-y-4 border-l border-[var(--sf-border)] pl-5">
                  {pricingFaq.map(item => (
                    <div key={item.id}>
                      <dt className="font-bold">{item.question}</dt>
                      <dd className="mt-1 text-sm leading-6 text-[var(--sf-text-muted)]">{item.answer}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>
        <section
          aria-labelledby="closing-heading"
          className="mx-auto max-w-5xl px-5 py-20 text-center sm:px-8 sm:py-28"
        >
          <p className="text-sm font-bold text-[var(--sf-brand-text)]">
            <Trans
              id="landing.closing.eyebrow"
              message="Your next word is waiting"
            />
          </p>
          <h2
            id="closing-heading"
            className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-black tracking-tight sm:text-6xl"
          >
            <Trans
              id="landing.closing.title"
              message="Build a vocabulary you can reach for."
            />
          </h2>
          <p className="mx-auto mt-5 max-w-xl leading-7 text-[var(--sf-text-muted)]">
            <Trans
              id="landing.closing.description"
              message="Start with the cards ready today, then make each new word easier to find again."
            />
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onEnterApp}
              className="brand-action inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-8 font-black text-[var(--sf-on-brand)] shadow-[var(--sf-panel-shadow)] transition hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 motion-reduce:transition-none sm:w-auto [html[data-theme-family=crystal]_&]:crystal-chamfer"
            >
              <Trans id="landing.hero.start" message="Start learning" />
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            {onSignIn && !user && (
              <button
                type="button"
                onClick={() => void onSignIn()}
                className={`${actionClass} w-full sm:w-auto`}
              >
                <Trans id="landing.hero.sign-in" message="Sign in to sync" />
              </button>
            )}
          </div>
          <p className="mx-auto mt-5 max-w-2xl text-sm text-[var(--sf-text-muted)]">
            <Trans
              id="landing.closing.consent"
              message="SonFlash is for learners aged 18 and over. By signing in, you agree to the <terms>Terms</terms> and have read the <privacy>Privacy Policy</privacy>."
              components={{
                terms: <a className="rounded underline focus-visible:outline-2 focus-visible:outline-offset-2" href="/terms.html" />,
                privacy: <a className="rounded underline focus-visible:outline-2 focus-visible:outline-offset-2" href="/privacy.html" />,
              }}
            />
          </p>
        </section>
      </main>
      <footer className="border-t border-[var(--sf-border)] px-5 py-7 text-sm text-[var(--sf-text-muted)] sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <p>
            <span className="font-bold text-[var(--sf-text)]">
              <Trans id="landing.brand.plain" message="SonFlash" />
            </span>{" "}
            <Trans
              id="landing.footer.description"
              message="for intentional vocabulary learning."
            />
          </p>
          <LocaleLinks compact />
          <p className="flex flex-wrap gap-x-4 gap-y-2">
            <a href="/privacy.html" className="rounded underline focus-visible:outline-2 focus-visible:outline-offset-2">
              <Trans id="landing.footer.privacy" message="Privacy Policy" />
            </a>
            <a href="/terms.html" className="rounded underline focus-visible:outline-2 focus-visible:outline-offset-2">
              <Trans id="landing.footer.terms" message="Terms" />
            </a>
            <a href="/browser-extension-privacy.html" className="rounded underline focus-visible:outline-2 focus-visible:outline-offset-2">
              <Trans id="landing.footer.extension" message="Extension" />
            </a>
            <span>
              <Trans
                id="landing.footer.copyright"
                message="© {year} SonFlash"
                values={{ year: new Date().getFullYear() }}
              />
            </span>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
