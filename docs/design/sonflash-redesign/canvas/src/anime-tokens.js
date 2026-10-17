    // Crystal Star — the anime theme: crimson faceted crystal wings, a faceted 5-point star, cross lens flares,
    // holo-cyan companion. dark = Starry Night, light = Prism Day (iridescent pillar). Display: t.fDisplay + font-style: italic + weight 800/900.
    const nkTokens = (dark) => {
      const base = {
        fDisplay: "'Kanit', 'Nunito', system-ui, sans-serif",
        fBody: "'Nunito', system-ui, sans-serif",
        fMono: "'Geist Mono', ui-monospace, monospace",
        crimson: '#ff2a4d', crimsonDeep: '#b30f33', blood: '#7a0820', rose: '#ff5470', holo: '#5ef2ff', pink: '#ff8fb6', gold: '#ffd166', violet: '#9b6bff',
        chamfer: 'polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px)',
        chamferSm: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)',
        prism: 'linear-gradient(115deg, #ffd6ec 0%, #d6ecff 24%, #bfe9ff 48%, #d0fbf2 66%, #ffe3f1 84%, #ffd6ec 100%)',
        crimsonGrad: 'linear-gradient(180deg, #ff5470 0%, #ff2a4d 45%, #b30f33 100%)',
        metal: 'linear-gradient(180deg, #ffffff 0%, #ffe3ea 45%, #ff8fa3 60%, #ffffff 100%)',
        // White metal for text sitting on crimson banners in both themes.
        metalHot: 'linear-gradient(180deg, #ffffff 0%, #ffe3ea 45%, #ff8fa3 60%, #ffffff 100%)',
        snap: 'cubic-bezier(.2,1.4,.4,1)',
        // Lumi, the study companion — transparent sprites in the canvas asset store.
        lumi: { hero: '../assets/blob/lumi-hero.webp', idle: '../assets/blob/lumi-idle.webp', happy: '../assets/blob/lumi-happy.webp', hint: '../assets/blob/lumi-hint.webp', oops: '../assets/blob/lumi-oops.webp', proud: '../assets/blob/lumi-proud.webp', chibi: '../assets/blob/lumi-chibi.webp', sleepy: '../assets/blob/lumi-sleepy.webp', thinking: '../assets/blob/lumi-thinking.webp', sad: '../assets/blob/lumi-sad.webp' },
        // Mastery tiers: a word grows from bud to bloom to star.
        tier: {
          new: { label: 'New', grade: 'Bud', color: '#5ef2ff', rim: 'linear-gradient(150deg, #e9feff, #5ef2ff 40%, #1aa7c9 75%, #e9feff)', glow: '0 0 36px -6px rgb(94 242 255 / 0.7)', soft: 'rgb(94 242 255 / 0.5)' },
          learning: { label: 'Learning', grade: 'Bloom', color: '#ff8fb6', rim: 'linear-gradient(150deg, #ffe3f1, #ff8fb6 35%, #ff5470 65%, #5ef2ff)', glow: '0 0 40px -6px rgb(255 143 182 / 0.8)', soft: 'rgb(255 143 182 / 0.55)' },
          mastered: { label: 'Mastered', grade: 'Star', color: '#ff2a4d', rim: 'conic-gradient(from 200deg, #fff3c4, #ffd166, #ff2a4d, #7a0820, #ff5470, #ffffff, #ffd166, #fff3c4)', glow: '0 0 56px -4px rgb(255 42 77 / 0.9)', soft: 'rgb(255 42 77 / 0.6)' },
        },
      };
      return dark ? {
        ...base, dark: true, light: false, toggleLabel: 'Switch to Prism Day',
        pageBg: '#04060c', text: '#f3f5fa', textStrong: '#ffffff', body: '#d6dbe6', text2: '#aab3c5', text3: '#7a8397',
        panel: 'linear-gradient(160deg, rgb(22 26 40 / 0.9), rgb(8 10 18 / 0.94))', panelSolid: '#0e111c',
        panelEdge: 'rgb(255 84 112 / 0.55)', panelEdge2: 'rgb(94 242 255 / 0.4)', panelShadow: '0 30px 60px -30px rgb(0 0 0 / 0.9)',
        line: 'rgb(255 255 255 / 0.1)', lineStrong: 'rgb(255 255 255 / 0.22)', chip: 'rgb(255 255 255 / 0.06)',
        primaryBg: 'linear-gradient(180deg, #ff5470 0%, #ff2a4d 45%, #b30f33 100%)', primaryText: '#ffffff', primaryGlow: '0 0 30px -4px rgb(255 42 77 / 0.85)',
        secondaryBg: 'rgb(255 255 255 / 0.06)', secondaryText: '#ffffff',
        crimsonText: '#ff6b85', holoText: '#5ef2ff', goldText: '#ffd166', violetText: '#ff9ec0', pinkText: '#ff9ec0',
        again: '#ff2a4d', hard: '#ff8a3d', good: '#5ef2ff', easy: '#ffd166',
        space: 'radial-gradient(ellipse 55% 45% at 18% 18%, rgb(16 42 92 / 0.55), transparent 70%), radial-gradient(ellipse 50% 45% at 85% 72%, rgb(10 50 110 / 0.5), transparent 70%), radial-gradient(ellipse 45% 35% at 62% 8%, rgb(179 15 51 / 0.3), transparent 70%), radial-gradient(ellipse 40% 30% at 30% 95%, rgb(122 8 32 / 0.35), transparent 70%)',
        stars: 'radial-gradient(1.5px 1.5px at 6% 12%, #cfe0ff, transparent), radial-gradient(1px 1px at 18% 38%, #fff, transparent), radial-gradient(2px 2px at 31% 8%, #9fd0ff, transparent), radial-gradient(1px 1px at 44% 28%, #fff, transparent), radial-gradient(1.5px 1.5px at 57% 62%, #cfe0ff, transparent), radial-gradient(1px 1px at 69% 18%, #fff, transparent), radial-gradient(2px 2px at 81% 44%, #9fd0ff, transparent), radial-gradient(1px 1px at 93% 9%, #fff, transparent), radial-gradient(1.5px 1.5px at 12% 78%, #fff, transparent), radial-gradient(1px 1px at 38% 88%, #9fd0ff, transparent), radial-gradient(1.5px 1.5px at 74% 84%, #fff, transparent), radial-gradient(1px 1px at 88% 94%, #cfe0ff, transparent)',
        wingOpacity: 0.55, beam: 'rgb(255 255 255 / 0.08)', flare: '#ffffff',
        track: 'rgb(255 255 255 / 0.1)', scrim: 'rgb(4 3 10 / 0.72)',
        cardFront: 'linear-gradient(180deg, #121624 0%, #080a12 100%)', cardBack: 'linear-gradient(115deg, rgb(255 214 236 / 0.22), rgb(207 238 255 / 0.18) 50%, rgb(255 227 241 / 0.22)), linear-gradient(180deg, #141a2a, #090c16)',
      } : {
        ...base, dark: false, light: true, toggleLabel: 'Switch to Starry Night',
        // Page titles on the pale prism need an inked metal, not the white one.
        metal: 'linear-gradient(180deg, #0d1a33 0%, #0d1a33 45%, #b30f33 62%, #ff2a4d 100%)',
        pageBg: '#dff1ff', text: '#0d1a33', textStrong: '#081329', body: '#243553', text2: '#3f5272', text3: '#627392',
        panel: 'linear-gradient(160deg, rgb(238 249 255 / 0.9), rgb(208 234 255 / 0.86))', panelSolid: '#e6f5ff',
        panelEdge: 'rgb(224 23 63 / 0.55)', panelEdge2: 'rgb(26 167 201 / 0.45)', panelShadow: '0 26px 50px -28px rgb(20 70 130 / 0.45)',
        line: 'rgb(13 40 80 / 0.12)', lineStrong: 'rgb(13 40 80 / 0.24)', chip: 'rgb(226 244 255 / 0.9)',
        primaryBg: 'linear-gradient(180deg, #ff5470 0%, #e0173f 50%, #a30c2d 100%)', primaryText: '#ffffff', primaryGlow: '0 12px 28px -8px rgb(224 23 63 / 0.6)',
        secondaryBg: '#e6f5ff', secondaryText: '#081329',
        crimsonText: '#c40f35', holoText: '#0a7d99', goldText: '#8a5a00', violetText: '#b3265a', pinkText: '#b3265a',
        again: '#d1123a', hard: '#c25a0a', good: '#0a8fb0', easy: '#1f6fd6',
        space: 'radial-gradient(ellipse 50% 40% at 70% 20%, rgb(255 190 215 / 0.55), transparent 70%), radial-gradient(ellipse 45% 40% at 20% 80%, rgb(255 84 112 / 0.18), transparent 70%), linear-gradient(115deg, #a9dcff 0%, #c7ebff 24%, #b5e6ff 46%, #c9f6f4 66%, #9fd6ff 88%, #b8e4ff 100%)',
        stars: 'radial-gradient(2px 2px at 8% 14%, #fff, transparent), radial-gradient(1.5px 1.5px at 22% 36%, #fff, transparent), radial-gradient(2.5px 2.5px at 36% 10%, #fff, transparent), radial-gradient(1.5px 1.5px at 52% 30%, #fff, transparent), radial-gradient(2px 2px at 66% 16%, #fff, transparent), radial-gradient(1.5px 1.5px at 80% 40%, #fff, transparent), radial-gradient(2.5px 2.5px at 92% 12%, #fff, transparent), radial-gradient(2px 2px at 14% 70%, #fff, transparent), radial-gradient(1.5px 1.5px at 72% 78%, #fff, transparent)',
        wingOpacity: 0.42, beam: 'rgb(255 255 255 / 0.5)', flare: '#ffffff',
        track: 'rgb(13 40 80 / 0.12)', scrim: 'rgb(10 40 80 / 0.35)',
        cardFront: 'linear-gradient(180deg, #f2faff 0%, #d9eeff 100%)', cardBack: 'linear-gradient(115deg, #ffe0ef, #cdeaff 30%, #bfe9ff 55%, #d0fbf2 75%, #ffe6f2)',
      };
    };
    const nkNav = (t, active) => ['Today', 'Goals', 'Collection', 'Friends'].map((label, i) => ({
      label, current: i === active ? 'page' : 'false',
      bg: i === active ? t.primaryBg : 'transparent', color: i === active ? '#ffffff' : t.text2,
      glow: i === active ? t.primaryGlow : 'none',
    }));
    const nkCombo = (n) => n >= 5 ? 'DREAMY' : n === 4 ? 'SPARKLY' : n === 3 ? 'LOVELY' : n === 2 ? 'SWEET' : n === 1 ? 'NICE' : 'READY';
