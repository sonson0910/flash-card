import { BookOpen, CircleAlert, Loader2, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { getStoryStatusAnnouncement } from './practiceAccessibility';

interface StoryViewProps {
  story: { story: string; translation: string } | null;
  loading: boolean;
  error?: string | null;
  onGenerate: () => void;
  onClose: () => void;
}

export function StoryView({ story, loading, error = null, onGenerate, onClose }: StoryViewProps) {
  const loadingStatusRef = useRef<HTMLDivElement>(null);
  const storyHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading) {
      loadingStatusRef.current?.focus();
      return;
    }
    if (error) {
      errorRef.current?.focus();
      return;
    }
    if (story) storyHeadingRef.current?.focus();
  }, [error, loading, story]);

  const statusAnnouncement = getStoryStatusAnnouncement(loading, story !== null);

  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center py-4 sm:py-8" aria-busy={loading}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{loading ? '' : statusAnnouncement}</p>
      <div className="mb-6 flex w-full items-center justify-between px-2"><button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-full p-2 text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2 motion-reduce:transition-none" aria-label="Close story"><X size={24} aria-hidden="true" /></button><div className="text-sm font-bold text-[var(--sf-text-muted)]">Context story</div><div className="w-11" aria-hidden="true" /></div>
      {loading ? (
        <GsapEntrance animationKey="story-loading" ref={loadingStatusRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" className="mx-auto flex min-h-72 w-full max-w-lg flex-col items-center justify-center rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] shadow-[0_28px_70px_-52px_var(--sf-shadow)] focus-visible:outline-2"><Loader2 size={48} className="mb-4 animate-spin text-[var(--sf-brand-text)] motion-reduce:animate-none" aria-hidden="true" /><p className="text-center font-bold text-[var(--sf-text)]">Creating your story…</p></GsapEntrance>
      ) : error ? (
        <GsapEntrance
          animationKey={error}
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          variant="result"
          className="w-full max-w-lg rounded-[28px] border border-rose-300 bg-rose-50 p-7 text-center text-rose-900 shadow-[0_28px_70px_-52px_var(--sf-shadow)] focus-visible:outline-2 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100"
        >
          <CircleAlert className="mx-auto mb-4" size={36} aria-hidden="true" />
          <h2 className="text-lg font-black">Story generation stopped</h2>
          <p className="mt-2 text-sm leading-relaxed">{error}</p>
          <button type="button" onClick={onGenerate} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-700 px-5 py-3 font-bold text-white transition-colors hover:bg-rose-800 focus-visible:outline-2 motion-reduce:transition-none">
            <RefreshCw size={17} aria-hidden="true" /> Try again
          </button>
        </GsapEntrance>
      ) : story ? (
        <GsapEntrance animationKey={story.story} variant="result" className="w-full max-w-3xl rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8" aria-labelledby="story-heading">
          <div className="mb-6 flex items-center gap-3"><div className="rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3 text-[var(--sf-brand-text)]" aria-hidden="true"><BookOpen size={24} /></div><div><h2 id="story-heading" ref={storyHeadingRef} tabIndex={-1} className="text-balance text-2xl font-black tracking-tight focus-visible:outline-2">Reading in context</h2><p className="text-pretty text-xs font-bold text-[var(--sf-text-muted)]">A story built from your own vocabulary</p></div></div>
          <div className="space-y-4 divide-y divide-[var(--sf-border)]"><div className="pb-5"><span className="mb-3 block text-xs font-bold text-[var(--sf-brand-text)]">English</span><p className="font-medium leading-relaxed">{story.story}</p></div><div className="pt-5"><span className="mb-3 block text-xs font-bold text-[var(--sf-brand-text)]">Vietnamese translation</span><p lang="vi" className="font-medium leading-relaxed text-[var(--sf-text-muted)]">{story.translation}</p></div></div>
          <div className="mt-8 flex justify-center"><button data-color-role="primary" type="button" onClick={onGenerate} className="flex min-h-12 items-center gap-2 rounded-xl bg-[var(--sf-brand)] px-6 py-3 font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 motion-reduce:transition-none"><RefreshCw size={18} aria-hidden="true" /> Create another story</button></div>
        </GsapEntrance>
      ) : null}
    </div>
  );
}
