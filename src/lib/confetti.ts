// Lightweight HTML5 Canvas Confetti Engine (<1.5KB)
// Zero external libraries, smooth 60fps physics, auto-cleaning

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vRotation: number;
  opacity: number;
  shape: 'rect' | 'circle';
}

const COLORS = [
  '#0891b2', // Brand Cyan
  '#06b6d4', // Bright Cyan
  '#fbbf24', // Reward Amber
  '#34d399', // Success Emerald
  '#fb7185', // Rose
  '#a855f7', // Purple
  '#38bdf8', // Sky
];

export function triggerConfetti(originX = 0.5, originY = 0.6): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Respect reduced motion
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.zIndex = '99999';
  canvas.style.pointerEvents = 'none';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const width = (canvas.width = window.innerWidth * dpr);
  const height = (canvas.height = window.innerHeight * dpr);
  ctx.scale(dpr, dpr);

  const startX = window.innerWidth * originX;
  const startY = window.innerHeight * originY;

  const particleCount = Math.min(80, Math.floor(window.innerWidth / 12));
  const particles: Particle[] = [];

  for (let i = 0; i < particleCount; i++) {
    const angle = (Math.PI * (Math.random() * 1.6 - 0.8)) - Math.PI / 2; // Fan out upwards
    const speed = 7 + Math.random() * 14;
    particles.push({
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 4,
      vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * 360,
      vRotation: (Math.random() - 0.5) * 12,
      opacity: 1,
      shape: Math.random() > 0.3 ? 'rect' : 'circle',
    });
  }

  const startTime = performance.now();
  const duration = 2400; // 2.4 seconds

  function frame(now: number) {
    const elapsed = now - startTime;
    const progress = elapsed / duration;

    if (progress >= 1 || !ctx) {
      canvas.remove();
      return;
    }

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.38; // Gravity
      p.vx *= 0.985; // Air resistance
      p.rotation += p.vRotation;
      p.opacity = Math.max(0, 1 - Math.pow(progress, 1.8));

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;

      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
