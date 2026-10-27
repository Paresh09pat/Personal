'use client';

import { useId, useMemo } from 'react';
import { Particles, ParticlesProvider } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';
import { loadEmojiShape } from '@tsparticles/shape-emoji';

/** Registered once for the whole page, however many themed areas are mounted. */
let enginePromise;
const initEngine = (engine) => {
  enginePromise ??= (async () => {
    await loadSlim(engine);
    await loadEmojiShape(engine);
  })();
  return enginePromise;
};

/**
 * `rise`/`fall` drift across the area; `twinkle` stays put and fades in and out.
 * Emoji are used for every shape so they look the same as in the rest of the app.
 */
const EFFECTS = {
  hearts: { emoji: ['💗', '💖', '💕', '❤️', '💘'], mode: 'rise', count: 22, size: [16, 34] },
  petals: { emoji: ['🌸', '🌸', '🌺', '💮'], mode: 'fall', count: 20, size: [16, 30] },
  stars: { emoji: ['⭐', '✨', '🌟', '💫'], mode: 'twinkle', count: 34, size: [10, 24] },
  sparkle: { emoji: ['✨', '💫', '✨'], mode: 'twinkle', count: 28, size: [12, 26] },
  snow: { emoji: ['❄️', '❄️', '❅', '❆'], mode: 'fall', count: 36, size: [10, 24] },
  bubbles: { emoji: ['🫧', '🤍', '🫧'], mode: 'rise', count: 20, size: [14, 32] },
  confetti: { emoji: ['🎉', '🎊', '✨', '🎈', '💖'], mode: 'fall', count: 26, size: [14, 28] },
};

const optionsFor = (spec) => ({
  fullScreen: { enable: false },
  background: { color: { value: 'transparent' } },
  fpsLimit: 45,
  detectRetina: true,
  particles: {
    number: { value: spec.count, density: { enable: false } },
    shape: { type: 'emoji', options: { emoji: { value: spec.emoji } } },
    size: { value: { min: spec.size[0], max: spec.size[1] } },
    opacity:
      spec.mode === 'twinkle'
        ? { value: { min: 0.15, max: 0.95 }, animation: { enable: true, speed: 0.7, sync: false } }
        : { value: { min: 0.55, max: 0.95 } },
    move:
      spec.mode === 'twinkle'
        ? { enable: false }
        : {
            enable: true,
            direction: spec.mode === 'rise' ? 'top' : 'bottom',
            speed: { min: 0.6, max: 1.8 },
            straight: false,
            outModes: { default: 'out' },
          },
  },
});

/** Slow, decorative particles behind the messages, powered by tsParticles. */
export default function ThemeFxInner({ type }) {
  const spec = EFFECTS[type];
  const options = useMemo(() => (spec ? optionsFor(spec) : null), [spec]);
  const id = `fx-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!options) return null;
  return (
    <ParticlesProvider init={initEngine}>
      <Particles id={id} options={options} className="pointer-events-none absolute inset-0 z-0" style={{ position: 'absolute', inset: 0 }} />
    </ParticlesProvider>
  );
}
