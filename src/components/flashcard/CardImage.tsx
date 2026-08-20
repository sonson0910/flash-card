import { ImageOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDisplayImageUrl } from '../../lib/images';

interface CardImageProps {
  src: string;
  alt: string;
  priority?: boolean;
  onUnavailable?: () => void;
}

export function CardImage({ src, alt, priority = false, onUnavailable }: CardImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const unavailableReportedRef = useRef(false);
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const displaySrc = getDisplayImageUrl(src);
  const markUnavailable = useCallback(() => {
    setFailed(true);
    if (unavailableReportedRef.current) return;
    unavailableReportedRef.current = true;
    onUnavailableRef.current?.();
  }, []);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    unavailableReportedRef.current = false;
    const image = imageRef.current;
    if (image?.complete) {
      if (image.naturalWidth > 0) setLoaded(true);
      else markUnavailable();
    }
    if (!priority) return;
    const timeoutId = window.setTimeout(() => {
      const currentImage = imageRef.current;
      if (!currentImage?.complete || currentImage.naturalWidth === 0) markUnavailable();
    }, 8000);
    return () => clearTimeout(timeoutId);
  }, [displaySrc, markUnavailable, priority]);

  return (
    <div className="relative w-full h-full">
      {!loaded && !failed && (
        <div className="absolute inset-0 z-10 overflow-hidden bg-[var(--sf-surface-raised)]" role="status" aria-label="Loading image">
          <div className="absolute -left-10 top-1/3 h-20 w-[calc(100%+5rem)] rotate-[-8deg] bg-white/35 blur-2xl dark:bg-white/5" />
        </div>
      )}
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--sf-surface-raised)]">
          <div className="flex flex-col items-center gap-3 text-[var(--sf-text-muted)]" role="img" aria-label={`No image for ${alt}`}>
            <span className="liquid-control flex size-16 items-center justify-center rounded-[22px]"><ImageOff size={28} strokeWidth={1.5} /></span>
            <span className="text-sm font-semibold">Image cue unavailable</span>
          </div>
        </div>
      ) : (
        <div className="relative w-full h-full overflow-hidden">
          <img
            ref={imageRef}
            src={displaySrc}
            alt={alt}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={markUnavailable}
            className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            referrerPolicy="no-referrer"
          />
          {/* Subtle dark tint overlay for enhanced text contrast and luxury mood */}
          <div className="pointer-events-none absolute inset-0 bg-slate-950/25 dark:bg-black/40 transition-colors" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
