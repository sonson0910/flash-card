import { BookOpen, Loader2, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { getStoryStatusAnnouncement } from './practiceAccessibility';

interface StoryViewProps {
  story: { story: string; translation: string } | null;
  loading: boolean;
  onGenerate: () => void;
  onClose: () => void;
}

export function StoryView({ story, loading, onGenerate, onClose }: StoryViewProps) {
  const loadingStatusRef = useRef<HTMLDivElement>(null);
  const storyHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (loading) {
      loadingStatusRef.current?.focus();
      return;
    }
    if (story) storyHeadingRef.current?.focus();
  }, [loading, story]);

  const statusAnnouncement = getStoryStatusAnnouncement(loading, story !== null);

  return (
    <div className="max-w-2xl mx-auto flex flex-col items-center pt-8" aria-busy={loading}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{loading ? '' : statusAnnouncement}</p>
      <div className="w-full flex items-center justify-between mb-8 px-4"><button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-full p-2 text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)]" aria-label="Close story"><X size={24} aria-hidden="true" /></button><div className="text-sm font-bold text-[var(--sf-text-muted)]">Context story</div><div className="w-10" aria-hidden="true" /></div>
      {loading ? (
        <GsapEntrance animationKey="story-loading" ref={loadingStatusRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" className="mx-auto flex h-[300px] w-full max-w-sm flex-col items-center justify-center rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] shadow-xl focus:outline-none"><Loader2 size={48} className="animate-spin text-[var(--sf-brand-text)] mb-4" aria-hidden="true" /><p className="font-bold text-[var(--sf-text)] text-center">Creating your story…</p></GsapEntrance>
      ) : story ? (
        <GsapEntrance animationKey={story.story} variant="result" className="w-full rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-8 text-[var(--sf-text)] shadow-2xl" aria-labelledby="story-heading">
          <div className="mb-6 flex items-center gap-3"><div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3 text-[var(--sf-brand-text)]" aria-hidden="true"><BookOpen size={24} /></div><div><h2 id="story-heading" ref={storyHeadingRef} tabIndex={-1} className="text-balance text-xl font-black focus:outline-none">Reading in context</h2><p className="text-pretty text-xs font-bold text-[var(--sf-text-muted)]">A story built from your own vocabulary</p></div></div>
          <div className="space-y-4 divide-y divide-[var(--sf-border)]"><div className="pb-5"><span className="mb-3 block text-xs font-bold text-[var(--sf-brand-text)]">English</span><p className="font-medium leading-relaxed">{story.story}</p></div><div className="pt-5"><span className="mb-3 block text-xs font-bold text-[var(--sf-brand-text)]">Vietnamese translation</span><p lang="vi" className="font-medium leading-relaxed text-[var(--sf-text-muted)]">{story.translation}</p></div></div>
          <div className="mt-8 flex justify-center"><button data-color-role="primary" type="button" onClick={onGenerate} className="flex items-center gap-2 rounded-xl bg-[var(--sf-brand)] px-6 py-3 font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white"><RefreshCw size={18} aria-hidden="true" /> Create another story</button></div>
        </GsapEntrance>
      ) : null}
    </div>
  );
}
