import { ImageOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getDisplayImageUrl } from '../../lib/images';

interface CardImageProps {
  src: string;
  alt: string;
  priority?: boolean;
}

export function CardImage({ src, alt, priority = false }: CardImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const displaySrc = getDisplayImageUrl(src);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    const image = imageRef.current;
    if (image?.complete) {
      if (image.naturalWidth > 0) setLoaded(true);
      else setFailed(true);
    }
    if (!priority) return;
    const timeoutId = window.setTimeout(() => {
      const currentImage = imageRef.current;
      if (!currentImage?.complete || currentImage.naturalWidth === 0) setFailed(true);
    }, 8000);
    return () => clearTimeout(timeoutId);
  }, [displaySrc, priority]);

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
        <img
          ref={imageRef}
          src={displaySrc}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`w-full h-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
