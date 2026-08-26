import { LandingMotion } from './LandingMotion';
import { LandingNavigation } from './LandingNavigation';
import {
  ClosingScene,
  HeroScene,
  JourneyScene,
  ProductProofScene,
  StudyTheaterScene,
  SystemBentoScene,
} from './LandingScenes';

interface LandingPageProps {
  readonly onEnterApp: () => void;
  readonly onOpenLibrary?: () => void;
  readonly onOpenCatalog?: () => void;
  readonly onOpenProgress?: () => void;
  readonly onSignIn?: () => void | Promise<void>;
  readonly user?: { displayName?: string | null; email?: string | null; photoURL?: string | null } | null;
}

export function LandingPage({ onEnterApp, onOpenLibrary, onOpenCatalog, onOpenProgress, onSignIn, user }: LandingPageProps) {
  return (
    <div className="min-h-[100svh] overflow-x-clip bg-[#050a0f] text-slate-100 selection:bg-cyan-100 selection:text-[#071014]">
      <LandingMotion>
        <main>
          <HeroScene onEnterApp={onEnterApp} navigation={<LandingNavigation onEnterApp={onEnterApp} onOpenLibrary={onOpenLibrary} onOpenCatalog={onOpenCatalog} onSignIn={onSignIn} user={user} />} />
          <ProductProofScene />
          <JourneyScene />
          <StudyTheaterScene />
          <SystemBentoScene onOpenProgress={onOpenProgress ?? onEnterApp} />
          <ClosingScene onEnterApp={onEnterApp} onSignIn={onSignIn} user={user} />
        </main>
      </LandingMotion>

      <footer className="border-t border-white/10 px-5 py-7 text-sm text-slate-400 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[96rem] flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <a href="#top" className="inline-flex min-h-11 items-center gap-2 rounded-lg font-bold text-slate-200 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-cyan-200">Son<span className="text-cyan-200">Flash</span></a>
          <p>© {new Date().getFullYear()} SonFlash</p>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
