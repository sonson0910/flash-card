import { useEffect, useRef, useState } from 'react';
import deepWoodsAv1 from '../../assets/landing/deep-woods.av1.mp4';
import deepWoodsH264 from '../../assets/landing/deep-woods.h264.mp4';
import goldenHourAv1 from '../../assets/landing/golden-hour.av1.mp4';
import goldenHourH264 from '../../assets/landing/golden-hour.h264.mp4';
import quietDawnAv1 from '../../assets/landing/quiet-dawn.av1.mp4';
import quietDawnH264 from '../../assets/landing/quiet-dawn.h264.mp4';
import stillWaterAv1 from '../../assets/landing/still-water.av1.mp4';
import stillWaterH264 from '../../assets/landing/still-water.h264.mp4';
import { ArrowRight, BookOpen, Brain, Headphones, Layers, Menu, Sparkles, X } from 'lucide-react';

interface LandingPageProps {
  readonly onEnterApp: () => void;
  readonly onOpenLibrary?: () => void;
  readonly onOpenCatalog?: () => void;
  readonly onOpenProgress?: () => void;
  readonly onSignIn?: () => void | Promise<void>;
  readonly user?: { displayName?: string | null; email?: string | null; photoURL?: string | null } | null;
}

const videos = [
  { label: 'Golden Hour', av1: goldenHourAv1, h264: goldenHourH264 },
  { label: 'Still Water', av1: stillWaterAv1, h264: stillWaterH264 },
  { label: 'Deep Woods', av1: deepWoodsAv1, h264: deepWoodsH264 },
  { label: 'Quiet Dawn', av1: quietDawnAv1, h264: quietDawnH264 },
];

const learningFlow = [
  { icon: Sparkles, title: 'Capture the whole context', description: 'Turn a word or passage into a card with meaning, pronunciation, examples, and a memorable hook.' },
  { icon: BookOpen, title: 'Read before you rehearse', description: 'Meet each word in plain language, then move from recognition into active recall.' },
  { icon: Headphones, title: 'Practice in more than one way', description: 'Switch between review, listening, spelling, and speaking when the learning moment calls for it.' },
  { icon: Layers, title: 'Keep one personal library', description: 'Your vocabulary, learning paths, and progress stay connected instead of becoming separate chores.' },
];

export function LandingPage({ onEnterApp, onOpenLibrary, onOpenCatalog, onSignIn, user }: LandingPageProps) {
  const [activeVideo, setActiveVideo] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [saveData, setSaveData] = useState(false);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const mobileNavRef = useRef<HTMLDetailsElement | null>(null);

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
    videoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index === activeVideo && !prefersReducedMotion && !saveData) {
        if (video.readyState === HTMLMediaElement.HAVE_NOTHING) video.load();
        video.play().catch(() => undefined);
      } else video.pause();
    });
  }, [activeVideo, prefersReducedMotion, saveData]);

  return (
    <div className="min-h-[100svh] overflow-x-clip bg-[#061014] text-slate-100 selection:bg-cyan-300 selection:text-[#061014]">
      <main>
        <section className="relative min-h-[100svh] overflow-hidden border-b border-white/10 bg-[#061014]" aria-labelledby="landing-heading">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0b2630] via-[#07161b] to-[#03090b]" aria-hidden="true" />
          <div className="absolute inset-0" aria-hidden="true">
            {videos.map((video, index) => (
              <video
                key={video.label}
                ref={element => { videoRefs.current[index] = element; }}
                data-hero-video
                autoPlay={index === activeVideo && !prefersReducedMotion && !saveData}
                muted
                loop
                playsInline
                preload={index === activeVideo && !saveData ? 'metadata' : 'none'}
                className={`absolute inset-0 size-full object-cover transition-opacity duration-700 motion-reduce:transition-none ${index === activeVideo ? 'opacity-70' : 'opacity-0'}`}
              >
                <source src={video.av1} type='video/mp4; codecs="av01.0.08M.08"' />
                <source src={video.h264} type='video/mp4; codecs="avc1.640028"' />
              </video>
            ))}
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,9,11,.94)_0%,rgba(3,9,11,.76)_46%,rgba(3,9,11,.35)_100%)]" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#061014] via-transparent to-black/45" />
          </div>

          <img
            src="https://soft-zoom-63098134.figma.site/_assets/v11/0b4a435b2df2747593c43d7a1c9b4578f7d8d90c.png"
            alt=""
            aria-hidden="true"
            className="train-bob pointer-events-none absolute inset-0 size-full object-cover opacity-65 motion-reduce:animate-none"
          />

          <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-[92rem] flex-col px-5 py-5 sm:px-8 lg:px-12">
            <header className="flex items-center justify-between gap-5">
              <a href="#top" className="flex min-h-11 items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300">
                <img src="/brand/sonflash-logo-192.png?v=3e7aaa58" alt="" className="size-10 rounded-xl object-cover" />
                <span className="text-xl font-black tracking-[-0.04em] text-white">Son<span className="text-cyan-300">Flash</span></span>
              </a>

              <nav aria-label="Landing navigation" className="hidden items-center gap-3 rounded-full border border-white/12 bg-black/25 px-3 text-sm font-semibold text-slate-200 backdrop-blur-xl md:flex">
                <a href="#features" className="flex min-h-11 items-center rounded-full px-3 hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">AI Features</a>
                <a href="#methods" className="flex min-h-11 items-center rounded-full px-3 hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">FSRS Method</a>
                <button type="button" onClick={onOpenCatalog ?? onEnterApp} className="min-h-11 rounded-full px-3 hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">Curriculum</button>
                <button type="button" onClick={onOpenLibrary ?? onEnterApp} className="min-h-11 rounded-full px-3 hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">Vocabulary Library</button>
              </nav>

              <details
                ref={mobileNavRef}
                className="group relative md:hidden"
                onKeyDown={event => {
                  if (event.key !== 'Escape' || !event.currentTarget.open) return;
                  event.preventDefault();
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector('summary')?.focus();
                }}
              >
                <summary aria-label="Open navigation menu" className="flex size-11 cursor-pointer list-none items-center justify-center rounded-full border border-white/20 bg-black/25 text-white backdrop-blur-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200 [&::-webkit-details-marker]:hidden">
                  <Menu size={19} className="group-open:hidden" aria-hidden="true" />
                  <X size={19} className="hidden group-open:block" aria-hidden="true" />
                </summary>
                <nav aria-label="Mobile navigation" className="absolute right-0 top-14 z-20 flex w-64 flex-col rounded-3xl border border-white/15 bg-[#07161b]/95 p-3 text-base font-bold text-white shadow-2xl backdrop-blur-2xl">
                  <a href="#features" onClick={() => { mobileNavRef.current?.removeAttribute('open'); }} className="flex min-h-11 items-center rounded-2xl px-4 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200">AI Features</a>
                  <a href="#methods" onClick={() => { mobileNavRef.current?.removeAttribute('open'); }} className="flex min-h-11 items-center rounded-2xl px-4 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200">FSRS Method</a>
                  <button type="button" onClick={() => { mobileNavRef.current?.removeAttribute('open'); (onOpenCatalog ?? onEnterApp)(); }} className="min-h-11 rounded-2xl px-4 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200">Curriculum</button>
                  <button type="button" onClick={() => { mobileNavRef.current?.removeAttribute('open'); (onOpenLibrary ?? onEnterApp)(); }} className="min-h-11 rounded-2xl px-4 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200">Vocabulary Library</button>
                  {onSignIn && !user && <button type="button" onClick={() => { mobileNavRef.current?.removeAttribute('open'); void onSignIn(); }} className="min-h-11 rounded-2xl px-4 text-left text-cyan-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200">Sign in with Google</button>}
                </nav>
              </details>
            </header>

            <div id="top" className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,.7fr)] lg:py-16">
              <div className="max-w-4xl">
                <p className="mb-5 text-sm font-bold text-cyan-200">English vocabulary, remembered</p>
                <h1 id="landing-heading" className="font-serif-hero text-balance text-[clamp(3.4rem,8vw,7.6rem)] leading-[.88] tracking-[-0.055em] text-white">
                  Remember words.<br />Use them when it matters.
                </h1>
                <p className="mt-7 max-w-xl text-pretty text-base leading-7 text-slate-200 sm:text-lg">
                  Capture vocabulary in context, review it on schedule, and practice recall in the way that fits today.
                </p>
                <button type="button" onClick={onEnterApp} className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-full bg-cyan-300 px-7 py-3 font-black text-[#061014] shadow-xl shadow-cyan-950/40 transition hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200 motion-reduce:transition-none">
                  Start learning <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>

              <fieldset className="self-end border-l border-white/20 pl-5 lg:mb-4 lg:justify-self-end">
                <legend className="mb-3 text-xs font-bold text-slate-300">Choose an atmosphere</legend>
                <div className="flex max-w-full flex-wrap gap-x-4 gap-y-2">
                  {videos.map((video, index) => (
                    <button
                      key={video.label}
                      type="button"
                      aria-pressed={index === activeVideo}
                      onPointerDown={event => event.currentTarget.focus({ preventScroll: true })}
                      onClick={() => setActiveVideo(index)}
                      className={`min-h-11 border-b px-1 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200 motion-reduce:transition-none ${index === activeVideo ? 'border-cyan-300 text-cyan-200' : 'border-transparent text-slate-300 hover:text-white'}`}
                    >
                      {video.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
        </section>

        <section id="features" aria-labelledby="features-heading" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32 lg:px-12">
          <div className="grid gap-14 lg:grid-cols-[minmax(16rem,.7fr)_minmax(0,1.3fr)] lg:gap-24">
            <header className="lg:sticky lg:top-10 lg:self-start">
              <p className="text-sm font-bold text-cyan-300">One continuous learning loop</p>
              <h2 id="features-heading" className="mt-4 max-w-md text-balance text-4xl font-black tracking-[-0.045em] text-white sm:text-5xl">A word should never become another loose note.</h2>
              <p className="mt-5 max-w-md text-pretty leading-7 text-slate-300">SonFlash carries each word from first encounter to confident recall, with the next useful action always close by.</p>
            </header>

            <ol className="border-t border-white/15">
              {learningFlow.map((item, index) => {
                const Icon = item.icon;
                return (
                  <li key={item.title} className="grid gap-4 border-b border-white/15 py-8 sm:grid-cols-[3rem_minmax(0,1fr)] sm:py-10">
                    <div className="flex size-11 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-200" aria-hidden="true"><Icon size={19} /></div>
                    <div>
                      <p className="text-xs font-bold text-cyan-300">0{index + 1}</p>
                      <h3 className="mt-2 text-2xl font-black tracking-tight text-white">{item.title}</h3>
                      <p className="mt-2 max-w-2xl text-pretty leading-7 text-slate-300">{item.description}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section id="methods" aria-labelledby="methods-heading" className="border-y border-white/10 bg-[#030a0d] px-5 py-24 sm:px-8 sm:py-32 lg:px-12">
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[minmax(0,.75fr)_minmax(28rem,1.25fr)] lg:gap-20">
            <div>
              <div className="flex size-12 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-200" aria-hidden="true"><Brain size={21} /></div>
              <h2 id="methods-heading" className="mt-6 text-balance text-4xl font-black tracking-[-0.045em] text-white sm:text-5xl">Review what is ready. Then let recall shape what comes next.</h2>
              <p className="mt-6 text-pretty leading-7 text-slate-300">SonFlash uses FSRS scheduling and your Again, Hard, Good, or Easy feedback to plan later reviews.</p>
              <dl className="mt-9 space-y-5 border-l border-cyan-300/35 pl-5">
                <div><dt className="font-bold text-white">See the meaning in context</dt><dd className="mt-1 text-sm leading-6 text-slate-400">Translation, explanation, and memory hook follow a clear reading order.</dd></div>
                <div><dt className="font-bold text-white">Judge your recall honestly</dt><dd className="mt-1 text-sm leading-6 text-slate-400">Four familiar ratings keep the decision quick and understandable.</dd></div>
                <div><dt className="font-bold text-white">Return to the right words</dt><dd className="mt-1 text-sm leading-6 text-slate-400">Today and Progress keep scheduled work visible without turning study into a dashboard.</dd></div>
              </dl>
            </div>

            <figure className="overflow-hidden rounded-[2rem] border border-white/15 bg-[#0a171c] p-2 shadow-[0_40px_100px_-50px_rgba(34,211,238,.45)] sm:p-3">
              <img src="/marketing/sonflash-study-preview.png" alt="SonFlash study session showing a Vietnamese meaning, explanation, memory hook, and four recall ratings" width="896" height="987" className="h-auto w-full rounded-[1.5rem] object-cover object-top" loading="lazy" />
              <figcaption className="px-4 py-3 text-xs leading-5 text-slate-400">The real SonFlash study view, shown with a sample local card.</figcaption>
            </figure>
          </div>
        </section>

        <section aria-labelledby="closing-heading" className="mx-auto max-w-5xl px-5 py-24 text-center sm:px-8 sm:py-32">
          <p className="text-sm font-bold text-cyan-300">Your next word is waiting</p>
          <h2 id="closing-heading" className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-black tracking-[-0.045em] text-white sm:text-6xl">Build a vocabulary you can actually reach for.</h2>
          <p className="mx-auto mt-5 max-w-xl text-pretty leading-7 text-slate-300">Start with your own words, follow a learning path, or return to the cards ready today.</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button type="button" onClick={onEnterApp} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-cyan-300 px-8 py-3 font-black text-[#061014] transition hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200 motion-reduce:transition-none sm:w-auto">Start learning <ArrowRight size={18} aria-hidden="true" /></button>
            {onSignIn && !user && <button type="button" onClick={onSignIn} className="min-h-12 w-full rounded-full border border-white/20 px-8 py-3 font-bold text-white transition hover:border-cyan-200/60 hover:text-cyan-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200 motion-reduce:transition-none sm:w-auto">Sign in with Google</button>}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-5 py-7 text-sm text-slate-400 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-2 sm:flex-row">
          <p><span className="font-bold text-slate-200">SonFlash</span> for intentional vocabulary learning.</p>
          <p>© {new Date().getFullYear()} SonFlash</p>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
