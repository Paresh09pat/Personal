'use client';

import dynamic from 'next/dynamic';

/** The particle engine is only downloaded when a themed chat actually needs it. */
const Inner = dynamic(() => import('./ThemeFxInner'), { ssr: false });

export function ThemeFx({ type }) {
  return type ? (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden motion-reduce:hidden" aria-hidden>
      <Inner type={type} />
    </div>
  ) : null;
}
