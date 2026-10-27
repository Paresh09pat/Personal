/**
 * Shared chat themes. A theme restyles the chat background, both bubble colours and the accent
 * colour used by the space header/tabs, and can add a light animated overlay (`fx`).
 *   bg      CSS `background` for the message area
 *   me/them bubble backgrounds; meInk/themInk their text colours
 *   accent  space accent (icons, send button, tabs); accentInk is the text colour on it
 *   fx      hearts | petals | stars | snow | bubbles | confetti | sparkle | null
 */
const T = (label, group, { bg, me, meInk = '#ffffff', them, themInk, accent, accentInk = '#ffffff', fx = null, dark = false }) => ({
  label,
  group,
  bg,
  me,
  meInk,
  them,
  themInk,
  accent,
  accentInk,
  fx,
  dark,
});

const dots = 'radial-gradient(color-mix(in oklab, var(--accent) 7%, transparent) 1px, transparent 1px) 0 0 / 22px 22px, var(--bg-deep)';

export const CHAT_THEME_PRESETS = {
  classic: { label: 'Classic', group: 'Everyday', bg: dots, fx: null, plain: true },
  love: T('Love', 'Romantic', { bg: 'linear-gradient(165deg,#ff758c,#ff7eb3 50%,#c94b9b)', me: 'linear-gradient(135deg,#be185d,#9d174d)', them: '#fff0f5', themInk: '#4a1230', accent: '#be185d', fx: 'hearts' }),
  blossom: T('Blossom', 'Romantic', { bg: 'linear-gradient(170deg,#ffe4ec,#ffc8dd 55%,#f9a8d4)', me: 'linear-gradient(135deg,#ec4899,#db2777)', them: '#ffffff', themInk: '#5b2142', accent: '#db2777', fx: 'petals' }),
  rosegold: T('Rose gold', 'Romantic', { bg: 'linear-gradient(160deg,#f6d5c8,#e8b4a0 50%,#d4a5a5)', me: 'linear-gradient(135deg,#b76e79,#8e4a56)', them: '#fff7f3', themInk: '#4a2a2f', accent: '#b76e79', fx: 'sparkle' }),
  valentine: T('Valentine', 'Romantic', { bg: 'linear-gradient(170deg,#7f1d1d,#be123c 60%,#e11d48)', me: 'linear-gradient(135deg,#fda4af,#fb7185)', meInk: '#4c0519', them: 'rgba(255,255,255,.16)', themInk: '#fff0f3', accent: '#fb7185', accentInk: '#4c0519', fx: 'hearts', dark: true }),
  candy: T('Candy', 'Romantic', { bg: 'linear-gradient(160deg,#a5f3fc,#fbcfe8 50%,#ddd6fe)', me: 'linear-gradient(135deg,#f472b6,#a78bfa)', them: '#ffffff', themInk: '#4c1d95', accent: '#a855f7', fx: 'bubbles' }),
  midnight: T('Midnight', 'Moody', { bg: 'linear-gradient(170deg,#0b1020,#1e1b4b 60%,#312e81)', me: 'linear-gradient(135deg,#6366f1,#8b5cf6)', them: 'rgba(255,255,255,.12)', themInk: '#e0e7ff', accent: '#818cf8', accentInk: '#0b1020', fx: 'stars', dark: true }),
  aurora: T('Aurora', 'Moody', { bg: 'linear-gradient(160deg,#052e2b,#0f766e 40%,#4c1d95)', me: 'linear-gradient(135deg,#34d399,#22d3ee)', meInk: '#022c22', them: 'rgba(255,255,255,.14)', themInk: '#ecfeff', accent: '#34d399', accentInk: '#022c22', fx: 'stars', dark: true }),
  neon: T('Neon', 'Moody', { bg: 'linear-gradient(160deg,#0f0f23,#1a0b2e 55%,#3b0764)', me: 'linear-gradient(135deg,#f0abfc,#22d3ee)', meInk: '#1e0a3c', them: 'rgba(255,255,255,.1)', themInk: '#f5d0fe', accent: '#e879f9', accentInk: '#1e0a3c', fx: 'sparkle', dark: true }),
  lofi: T('Lo-fi', 'Moody', { bg: 'linear-gradient(170deg,#2b2540,#3d3555 55%,#5b4b6b)', me: 'linear-gradient(135deg,#f4a261,#e76f51)', meInk: '#2b1b12', them: 'rgba(255,255,255,.14)', themInk: '#f1e9f7', accent: '#f4a261', accentInk: '#2b1b12', fx: 'stars', dark: true }),
  ocean: T('Ocean', 'Fresh', { bg: 'linear-gradient(175deg,#e0f7ff,#8fd3f4 55%,#2b8fc4)', me: 'linear-gradient(135deg,#0284c7,#0369a1)', them: '#ffffff', themInk: '#0c4a6e', accent: '#0284c7', fx: 'bubbles' }),
  beach: T('Beach', 'Fresh', { bg: 'linear-gradient(175deg,#fff3c4,#ffd39b 45%,#ff9f7a)', me: 'linear-gradient(135deg,#f97316,#ea580c)', them: '#fffaf0', themInk: '#5a2e0c', accent: '#ea580c', fx: 'sparkle' }),
  mint: T('Mint', 'Fresh', { bg: 'linear-gradient(170deg,#e6fff4,#b7f0d4 55%,#7fdcb4)', me: 'linear-gradient(135deg,#10b981,#059669)', them: '#ffffff', themInk: '#064e3b', accent: '#059669', fx: 'bubbles' }),
  forest: T('Forest', 'Fresh', { bg: 'linear-gradient(170deg,#14532d,#166534 55%,#365314)', me: 'linear-gradient(135deg,#86efac,#4ade80)', meInk: '#052e16', them: 'rgba(255,255,255,.14)', themInk: '#ecfccb', accent: '#4ade80', accentInk: '#052e16', fx: 'sparkle', dark: true }),
  celebration: T('Celebration', 'Seasonal', { bg: 'linear-gradient(160deg,#fff7ed,#ffe4f1 50%,#e0e7ff)', me: 'linear-gradient(135deg,#f43f5e,#f59e0b)', them: '#ffffff', themInk: '#4a1d3b', accent: '#f43f5e', fx: 'confetti' }),
  snow: T('Snowfall', 'Seasonal', { bg: 'linear-gradient(175deg,#1e3a5f,#4a6fa5 55%,#a8c4e0)', me: 'linear-gradient(135deg,#e0f2fe,#bae6fd)', meInk: '#0c2d48', them: 'rgba(255,255,255,.2)', themInk: '#f0f9ff', accent: '#7dd3fc', accentInk: '#0c2d48', fx: 'snow', dark: true }),
};

export const THEME_ICON = {
  classic: '💞', love: '💗', blossom: '🌸', rosegold: '✨', valentine: '💘', candy: '🫧',
  midnight: '🌙', aurora: '🌌', neon: '💜', lofi: '🎧', ocean: '🌊', beach: '🏖️',
  mint: '🍃', forest: '🌲', celebration: '🎉', snow: '❄️',
};

export const THEME_GROUPS = ['Everyday', 'Romantic', 'Moody', 'Fresh', 'Seasonal'];

const swatchOf = (p) => (p.plain ? 'linear-gradient(135deg,#fde4ec,#f8e8e6)' : p.bg);
export const themeSwatch = (key) => swatchOf(CHAT_THEME_PRESETS[key] ?? CHAT_THEME_PRESETS.classic);

const presetFor = (prefs) => CHAT_THEME_PRESETS[prefs?.theme] ?? null;

/** CSS variables for the whole space shell (accent + bubble colours). Empty for classic/custom. */
export function themeVars(prefs) {
  const p = presetFor(prefs);
  if (!p || p.plain) return {};
  return {
    '--accent': p.accent,
    '--accent-ink': p.accentInk,
    '--accent-soft': `color-mix(in oklab, ${p.accent} 20%, transparent)`,
    '--bubble-me': p.me,
    '--bubble-me-ink': p.meInk,
    '--bubble-them-bg': p.them,
    '--bubble-them-ink': p.themInk,
  };
}

/** Background of the message area. `wallpaperUrl` is used for the "custom" photo theme. */
export function chatBackgroundStyle(prefs, wallpaperUrl) {
  if (prefs?.theme === 'custom' && wallpaperUrl) {
    const dim = (prefs.wallpaperDim ?? 25) / 100;
    return {
      backgroundImage: `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${wallpaperUrl}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return { background: (presetFor(prefs) ?? CHAT_THEME_PRESETS.classic).bg };
}

export const themeFx = (prefs) => (prefs?.themeAnimated === false ? null : (presetFor(prefs)?.fx ?? null));

/** Disappearing-message choices (seconds). `0` = off. */
export const DISAPPEAR_PRESETS = [
  { sec: 0, label: 'Off' },
  { sec: 3600, label: '1 hour' },
  { sec: 86400, label: '24 hours' },
  { sec: 7 * 86400, label: '7 days' },
];

export function describeSeconds(sec) {
  if (!sec) return 'Off';
  const plural = (n, u) => `${n} ${u}${n === 1 ? '' : 's'}`;
  if (sec % 86400 === 0) return plural(sec / 86400, 'day');
  if (sec % 3600 === 0) return plural(sec / 3600, 'hour');
  return plural(Math.round(sec / 60), 'minute');
}
