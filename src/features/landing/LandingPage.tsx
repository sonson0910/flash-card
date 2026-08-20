import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronRight,
  Layers,
  Menu,
  Mic,
  Puzzle,
  Sparkles,
  Volume2,
  X,
  Zap,
} from 'lucide-react';

interface LandingPageProps {
  readonly onEnterApp: () => void;
  readonly onOpenLibrary?: () => void;
  readonly onOpenCatalog?: () => void;
  readonly onOpenProgress?: () => void;
  readonly onSignIn?: () => void | Promise<void>;
  readonly user?: { displayName?: string | null; email?: string | null; photoURL?: string | null } | null;
}

const videos = [
  {
    label: 'Golden Hour',
    src: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_081127_0992a171-d3c6-4978-8213-0ec5df8b6d63.mp4',
  },
  {
    label: 'Still Water',
    src: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_092026_dd05b805-ea0f-40b2-8c52-332b88502592.mp4',
  },
  {
    label: 'Deep Woods',
    src: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_081042_df7202bf-bd80-4b2b-bbc6-1f09ba2870e9.mp4',
  },
  {
    label: 'Quiet Dawn',
    src: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_080959_4cac5234-3573-464e-a5b7-76b94b8a7d61.mp4',
  },
];

const stats = [
  { label: '60,000+ Deep Memory Cards', icon: Layers },
  { label: '7+ AI Practice Modes', icon: Sparkles },
  { label: 'FSRS Precision Algorithm', icon: Brain },
  { label: 'Real-time Shadowing Scoring', icon: Mic },
];

const features = [
  {
    icon: Sparkles,
    badge: 'Smart AI Generation',
    title: 'Multi-Sensory Context & Visual Generation',
    description:
      'Input any English word or paragraph and let AI generate accurate IPA phonetics, clear definitions, natural business examples, collocations, and vivid illustrations in one click.',
    highlight: '1-Click complete flashcard creation',
  },
  {
    icon: Brain,
    badge: 'Spaced Repetition',
    title: 'FSRS Spaced Repetition Algorithm',
    description:
      'Scientifically schedules your reviews at optimal intervals, moving words from short-term memory to permanent long-term retention without cognitive overload.',
    highlight: 'Save up to 70% of study time',
  },
  {
    icon: Mic,
    badge: 'Speech & Shadowing',
    title: 'Native Accent Shadowing & Speech Match',
    description:
      'Listen to native audio, speak into your microphone, and receive real-time word-by-word pronunciation accuracy with actionable coaching tips.',
    highlight: 'Build natural speaking reflex and confidence',
  },
  {
    icon: Puzzle,
    badge: 'Gamified Learning',
    title: 'Adaptive Memory Games & Challenges',
    description:
      'Master words with high-speed Word Match, Speed Spelling drills, interactive AI Dialogue scenarios, and immersive Context Stories.',
    highlight: 'Engaging, gamified, and effective',
  },
];

export function LandingPage({
  onEnterApp,
  onOpenLibrary,
  onOpenCatalog,
  onSignIn,
  user,
}: LandingPageProps) {
  const [activeVideo, setActiveVideo] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [demoWord, setDemoWord] = useState('');
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [saveData, setSaveData] = useState(false);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);

  const isDarkMode = activeVideo === 2;
  const heroColor = isDarkMode ? '#e2e8f0' : '#ffffff';

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updateMotionPreference();
    mediaQuery.addEventListener?.('change', updateMotionPreference);
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    setSaveData(connection?.saveData === true);
    return () => mediaQuery.removeEventListener?.('change', updateMotionPreference);
  }, []);

  useEffect(() => {
    // Keep only the active scene playing; inactive videos stay paused and do not
    // compete for decode bandwidth while cross-fading.
    videoRefs.current.forEach((video, idx) => {
      if (!video) return;
      if (idx === activeVideo && !prefersReducedMotion && !saveData) {
        video.play().catch(() => {
          // Autoplay policy handled silently.
        });
      } else {
        video.pause();
      }
    });
  }, [activeVideo, prefersReducedMotion, saveData]);

  const switchVideo = (index: number) => {
    if (index === activeVideo || isTransitioning) return;
    setIsTransitioning(true);
    setActiveVideo(index);
    window.setTimeout(() => setIsTransitioning(false), 1000);
  };

  const handleDemoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onEnterApp();
  };

  return (
    <div className="relative min-h-screen w-full bg-[#071014] text-slate-100 selection:bg-cyan-500 selection:text-black">
      {/* 1. HERO SECTION (LUMORA CINEMATIC EXPERIENCE) */}
      <section className="relative h-screen w-full overflow-hidden bg-[#071014]">
        {/* Ambient Gradient Fallback Background */}
        <div className="absolute inset-0 bg-gradient-to-tr from-[#051117] via-[#0b242e] to-[#04161d]" />
        <div className="ambient-orb ambient-orb-a opacity-60" aria-hidden="true" />
        <div className="ambient-orb ambient-orb-b opacity-60" aria-hidden="true" />

        {/* Background Videos with Cross-fade */}
        <div className="absolute inset-0 z-0">
          {videos.map((video, index) => (
            <video
              key={video.src}
              ref={element => { videoRefs.current[index] = element; }}
              data-hero-video
              autoPlay={index === activeVideo && !prefersReducedMotion && !saveData}
              muted
              loop
              playsInline
              preload={index === activeVideo && !saveData ? 'metadata' : 'none'}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ease-in-out ${
                index === activeVideo ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <source src={video.src} type="video/mp4" />
            </video>
          ))}
          {/* Subtle Dark Overlay for enhanced text readability and contrast */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/40 to-black/85 backdrop-brightness-[0.88]" />
        </div>

        {/* Spatial Train Window Perspective Overlay */}
        <img
          src="https://soft-zoom-63098134.figma.site/_assets/v11/0b4a435b2df2747593c43d7a1c9b4578f7d8d90c.png"
          alt=""
          aria-hidden="true"
          className="train-bob pointer-events-none absolute inset-0 z-[1] h-full w-full object-cover opacity-85"
        />

        {/* Additional Subtle Dark Veil for Ultra-Crisp Typography */}
        <div className="pointer-events-none absolute inset-0 z-[1] bg-black/25" aria-hidden="true" />

        {/* Main Hero Container */}
        <div className="relative z-[2] flex h-full flex-col px-5 py-5 sm:px-8 sm:py-7 md:px-10 lg:px-14">
          {/* Top Liquid Glass Navbar */}
          <header className="flex items-center justify-between">
            {/* Brand Logo */}
            <div className="flex items-center gap-2.5">
              <div className="flex size-10 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-white/10 shadow-lg backdrop-blur-xl">
                <img
                  src="/brand/sonflash-logo-192.png?v=3e7aaa58"
                  alt="SonFlash"
                  className="size-10 object-cover"
                />
              </div>
              <span className="text-2xl font-black tracking-[-0.04em] text-white drop-shadow-md">
                Son<span className="text-cyan-300">Flash</span>
              </span>
            </div>

            {/* Desktop Navigation Links */}
            <nav className="liquid-glass hidden items-center gap-1.5 rounded-full px-2 py-1.5 md:flex border border-white/15 bg-black/35 backdrop-blur-2xl">
              <a
                href="#features"
                className="rounded-full px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:text-white hover:bg-white/10"
              >
                AI Features
              </a>
              <a
                href="#methods"
                className="rounded-full px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:text-white hover:bg-white/10"
              >
                FSRS Method
              </a>
              <button
                type="button"
                onClick={onOpenCatalog ?? onEnterApp}
                className="rounded-full px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:text-white hover:bg-white/10"
              >
                Curriculum
              </button>
              <button
                type="button"
                onClick={onOpenLibrary ?? onEnterApp}
                className="rounded-full px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:text-white hover:bg-white/10"
              >
                Vocabulary Library
              </button>
              <button
                type="button"
                onClick={onEnterApp}
                className="ml-2 flex items-center gap-1.5 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-extrabold text-[#071014] shadow-lg shadow-cyan-500/25 transition-all duration-300 hover:scale-[1.03] hover:bg-cyan-300 active:scale-[0.98]"
              >
                <span>Start Learning</span>
                <ArrowRight size={15} />
              </button>
            </nav>

            {/* Mobile Menu Button */}
            <button
              type="button"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(val => !val)}
              className="liquid-glass relative flex h-11 w-11 items-center justify-center rounded-full text-white border border-white/20 md:hidden"
            >
              <Menu
                size={20}
                className={`absolute transition-all duration-300 ${
                  menuOpen ? 'rotate-90 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100'
                }`}
              />
              <X
                size={20}
                className={`absolute transition-all duration-300 ${
                  menuOpen ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-75 opacity-0'
                }`}
              />
            </button>
          </header>

          {/* Center Hero Headline & Interactive CTA */}
          <main className="flex flex-1 flex-col items-center justify-center text-center">
            <div
              className="flex w-full flex-col items-center transition-colors duration-700"
              style={{ color: heroColor }}
            >
              {/* Badge */}
              <div
                className="liquid-glass mb-5 flex items-center gap-2 rounded-full border border-white/25 bg-black/40 px-4 py-2 text-xs font-semibold tracking-wide text-cyan-200 shadow-xl backdrop-blur-xl sm:text-sm"
              >
                <Sparkles size={14} className="text-cyan-300 animate-pulse" />
                <span>Next-Gen Vocabulary Learning · AI &amp; FSRS Algorithm</span>
              </div>

              {/* Editorial Main Heading */}
              <h1 className="font-serif-hero max-w-4xl text-5xl leading-[1.08] sm:text-6xl md:text-7xl lg:text-[5.5rem] tracking-tight drop-shadow-2xl">
                Master Vocabulary.
                <br />
                <span className="italic text-cyan-200">Unlock Infinite Fluency.</span>
              </h1>

              {/* Subheading */}
              <p className="mt-5 max-w-2xl px-3 text-sm font-normal leading-relaxed text-slate-100/95 sm:text-base md:text-lg drop-shadow-md">
                Transcend the limits of traditional flashcards. SonFlash combines precision FSRS spaced
                repetition, multi-sensory AI context, and real-time pronunciation scoring.
              </p>

              {/* Interactive Quick Start / Word Generator Input */}
              <form
                onSubmit={handleDemoSubmit}
                className="liquid-glass mt-8 flex w-full max-w-[340px] items-center rounded-full border border-white/25 bg-black/50 p-1.5 shadow-2xl backdrop-blur-2xl sm:max-w-md"
              >
                <input
                  type="text"
                  value={demoWord}
                  onChange={e => setDemoWord(e.target.value)}
                  placeholder="Enter a word to explore (e.g. Serendipity)..."
                  aria-label="Enter word"
                  className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/60"
                />
                <button
                  type="submit"
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-cyan-400 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-[#071014] shadow-md transition-transform duration-300 hover:scale-[1.03] hover:bg-cyan-300 active:scale-[0.98] sm:text-sm"
                >
                  <span>Start Now</span>
                  <ArrowRight size={14} />
                </button>
              </form>

              {/* Atmospheric Scene Switcher */}
              <div className="mt-8 flex max-w-[95vw] items-center gap-3 overflow-x-auto px-2 pb-1 text-xs sm:gap-6 sm:text-sm">
                <span className="text-[11px] uppercase tracking-wider text-white/60 hidden sm:inline">
                  Atmosphere:
                </span>
                {videos.map((video, index) => (
                  <button
                    key={video.src}
                    type="button"
                    disabled={isTransitioning && index !== activeVideo}
                    onClick={() => switchVideo(index)}
                    className={`whitespace-nowrap border-b-2 pb-1 font-semibold transition-all duration-300 ${
                      index === activeVideo
                        ? 'border-cyan-300 text-cyan-200 opacity-100 scale-105'
                        : 'border-transparent text-white/70 hover:text-white'
                    }`}
                  >
                    {video.label}
                  </button>
                ))}
              </div>
            </div>
          </main>

          {/* Bottom Social Proof & Metrics */}
          <footer className="mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pb-2 text-center text-xs font-semibold text-white/90 sm:text-sm md:gap-x-8 drop-shadow">
            {stats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="flex items-center gap-2">
                  <Icon size={14} className="text-cyan-300 shrink-0" />
                  <span>{stat.label}</span>
                  {index < stats.length - 1 && (
                    <span className="hidden text-white/40 md:inline ml-4">•</span>
                  )}
                </div>
              );
            })}
          </footer>
        </div>

        {/* Mobile Navigation Drawer */}
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-2xl transition-all duration-500 md:hidden ${
            menuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="liquid-glass absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full text-white border border-white/20"
          >
            <X size={20} />
          </button>

          <div className="flex h-full w-full flex-col items-center justify-center px-6">
            <div className="flex flex-col items-center gap-7 text-center">
              <a
                href="#features"
                onClick={() => setMenuOpen(false)}
                className="text-2xl font-bold text-white transition-colors hover:text-cyan-300"
              >
                AI Features
              </a>
              <a
                href="#methods"
                onClick={() => setMenuOpen(false)}
                className="text-2xl font-bold text-white transition-colors hover:text-cyan-300"
              >
                FSRS Method
              </a>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenCatalog?.();
                }}
                className="text-2xl font-bold text-white transition-colors hover:text-cyan-300"
              >
                Curriculum
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenLibrary?.();
                }}
                className="text-2xl font-bold text-white transition-colors hover:text-cyan-300"
              >
                Vocabulary Library
              </button>
              {onSignIn && !user && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onSignIn();
                  }}
                  className="text-xl font-bold text-cyan-300"
                >
                  Sign in with Google
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onEnterApp();
              }}
              className="absolute bottom-10 flex items-center gap-2 rounded-full bg-cyan-400 px-8 py-3.5 text-base font-black text-[#071014] shadow-xl shadow-cyan-500/30 active:scale-95"
            >
              <span>Start Learning</span>
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>

      {/* 2. FEATURE HIGHLIGHT SECTION */}
      <section id="features" className="relative z-10 px-5 py-24 sm:px-8 md:px-12 lg:px-16 max-w-7xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-cyan-300 mb-4">
            <Zap size={14} />
            Next-Gen Learning Ecosystem
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white">
            Every tool you need to <span className="text-cyan-400">accelerate fluency</span>
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-300 leading-relaxed">
            Say goodbye to dull rote memorization. SonFlash delivers a multi-sensory learning experience
            powered by artificial intelligence and cognitive science.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
          {features.map(f => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="group liquid-glass relative rounded-[28px] border border-white/10 bg-[#0d1a20]/80 p-6 sm:p-8 backdrop-blur-xl transition-all duration-300 hover:border-cyan-500/40 hover:bg-[#11242c]/90 hover:shadow-2xl hover:shadow-cyan-950/30"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/20 group-hover:scale-110 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-all duration-300">
                    <Icon size={22} />
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold text-slate-300">
                    {f.badge}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white mb-2 group-hover:text-cyan-300 transition-colors">
                  {f.title}
                </h3>
                <p className="text-sm leading-relaxed text-slate-400 mb-5">
                  {f.description}
                </p>
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                  <CheckCircle2 size={15} />
                  <span>{f.highlight}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. SCIENTIFIC FSRS SPACING REPETITION SECTION */}
      <section id="methods" className="relative z-10 border-y border-white/10 bg-[#050c0f] px-5 py-24 sm:px-8 md:px-12 lg:px-16">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-300 mb-4">
              <Brain size={14} />
              FSRS Memory Science
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white leading-tight">
              Retain vocabulary forever with the <span className="text-amber-300">FSRS Algorithm</span>
            </h2>
            <p className="mt-5 text-base sm:text-lg text-slate-300 leading-relaxed">
              Unlike simplistic repetition methods (legacy SM-2), the Free Spaced Repetition Scheduler
              (FSRS) calculates the exact difficulty and memory stability of every neural trace, prompting
              reviews right before you forget to form permanent long-term connections.
            </p>

            <ul className="mt-8 space-y-4">
              {[
                'Dynamically adjusts review intervals across 4 recall grades: Again, Hard, Good, Easy.',
                'Instant Cloud Sync across all your devices so your learning progress is always preserved.',
                'Visual Streak analytics and retention curves keep your motivation and consistency soaring.',
              ].map((item, idx) => (
                <li key={idx} className="flex items-start gap-3 text-sm sm:text-base text-slate-300 font-medium">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-slate-950 font-black text-xs mt-0.5">
                    {idx + 1}
                  </div>
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-10">
              <button
                type="button"
                onClick={onEnterApp}
                className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-300 px-7 py-3.5 text-base font-extrabold text-slate-950 shadow-lg shadow-amber-500/20 transition-all hover:scale-[1.03] active:scale-[0.98]"
              >
                <span>Experience FSRS Now</span>
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {/* Interactive Visual Graphic */}
          <div className="w-full lg:w-1/2 flex justify-center">
            <div className="liquid-glass relative w-full max-w-lg rounded-[32px] border border-white/15 bg-[#0b171c]/90 p-6 sm:p-8 shadow-2xl backdrop-blur-2xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-cyan-500 text-slate-950 font-black">
                    <Sparkles size={18} />
                  </span>
                  <div>
                    <h4 className="font-bold text-white text-base">Sample Flashcard</h4>
                    <p className="text-xs text-slate-400">Auto-generated by SonFlash AI</p>
                  </div>
                </div>
                <span className="rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-bold text-cyan-300 border border-cyan-500/30">
                  B2 • Oxford
                </span>
              </div>

              <div className="text-center py-4">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <h3 className="text-3xl font-black text-white">Resilience</h3>
                  <button type="button" className="p-1.5 text-cyan-400 hover:text-cyan-300">
                    <Volume2 size={20} />
                  </button>
                </div>
                <p className="text-sm font-mono text-cyan-300/80 mb-3">/rɪˈzɪl.jəns/</p>
                <div className="inline-block rounded-xl bg-cyan-500/10 border border-cyan-500/20 px-4 py-2 text-base font-bold text-cyan-200 mb-4">
                  The capacity to recover quickly from difficulties; toughness
                </div>
                <p className="text-sm italic text-slate-300 bg-white/5 p-3.5 rounded-xl border border-white/5">
                  &ldquo;Courage and resilience are essential for overcoming adversity.&rdquo;
                </p>
              </div>

              <div className="mt-6 grid grid-cols-4 gap-2 pt-4 border-t border-white/10">
                {[
                  { name: 'Again', time: '< 10m', color: 'border-rose-500/40 text-rose-300 bg-rose-500/10' },
                  { name: 'Hard', time: '1d', color: 'border-amber-500/40 text-amber-300 bg-amber-500/10' },
                  { name: 'Good', time: '3d', color: 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10' },
                  { name: 'Easy', time: '7d', color: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' },
                ].map(r => (
                  <div key={r.name} className={`rounded-xl border p-2 text-center ${r.color}`}>
                    <div className="text-xs font-black">{r.name}</div>
                    <div className="text-[10px] opacity-75">{r.time}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. FINAL CALL TO ACTION (CTA) */}
      <section className="relative z-10 px-5 py-24 sm:px-8 text-center max-w-4xl mx-auto">
        <div className="liquid-glass relative overflow-hidden rounded-[36px] border border-cyan-500/30 bg-gradient-to-b from-[#0e2730] to-[#071318] p-8 sm:p-14 shadow-2xl backdrop-blur-2xl">
          <div className="ambient-orb ambient-orb-a" aria-hidden="true" />
          <div className="relative z-10">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight">
              Ready to elevate your vocabulary?
            </h2>
            <p className="mt-4 max-w-xl mx-auto text-base sm:text-lg text-slate-300 leading-relaxed">
              Experience the full power of SonFlash completely free. Sign in to sync your progress
              instantly across all your devices.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                type="button"
                onClick={onEnterApp}
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-8 py-4 text-base font-black text-[#071014] shadow-xl shadow-cyan-500/30 transition-all hover:scale-[1.04] hover:bg-cyan-300 active:scale-[0.98]"
              >
                <span>Start Learning Free</span>
                <ArrowRight size={18} />
              </button>
              {onSignIn && !user && (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-7 py-4 text-base font-bold text-white backdrop-blur-xl transition-colors hover:bg-white/20"
                >
                  <span>Sign in with Google</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 5. FOOTER */}
      <footer className="relative z-10 border-t border-white/10 px-5 py-8 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-200">SonFlash</span>
            <span>— Smart Vocabulary Learning</span>
          </div>
          <div>© {new Date().getFullYear()} SonFlash. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
