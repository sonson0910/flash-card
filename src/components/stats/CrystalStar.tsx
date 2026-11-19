/** Five-point crystal star from the design canvas; decorative. */
export function CrystalStar({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      <polygon points="50.0,52.0 38.2,35.7 50.0,4.0" fill="#ff5470" />
      <polygon points="50.0,52.0 50.0,4.0 61.8,35.7" fill="#7a0820" />
      <polygon points="50.0,52.0 61.8,35.7 95.7,37.2" fill="#ff5470" />
      <polygon points="50.0,52.0 95.7,37.2 69.2,58.2" fill="#7a0820" />
      <polygon points="50.0,52.0 69.2,58.2 78.2,90.8" fill="#ff5470" />
      <polygon points="50.0,52.0 78.2,90.8 50.0,72.2" fill="#7a0820" />
      <polygon points="50.0,52.0 50.0,72.2 21.8,90.8" fill="#ff5470" />
      <polygon points="50.0,52.0 21.8,90.8 30.8,58.2" fill="#7a0820" />
      <polygon points="50.0,52.0 30.8,58.2 4.3,37.2" fill="#ff5470" />
      <polygon points="50.0,52.0 4.3,37.2 38.2,35.7" fill="#7a0820" />
    </svg>
  );
}
