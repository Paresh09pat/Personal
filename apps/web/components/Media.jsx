'use client';

import { useState } from 'react';
import { FileText, Play } from 'lucide-react';
import { Modal, cx } from './ui';

/** Renders one private attachment. URLs point at the server, which re-checks access on every request. */
export function MediaThumb({ a, className, onOpen }) {
  if (a.kind === 'image') {
    return (
      <button type="button" onClick={() => onOpen?.(a)} className={cx('block overflow-hidden', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked media */}
        <img src={a.url} alt={a.fileName} loading="lazy" className="h-full w-full object-cover transition hover:scale-[1.02]" />
      </button>
    );
  }
  if (a.kind === 'video') {
    return (
      <button type="button" onClick={() => onOpen?.(a)} className={cx('relative block overflow-hidden bg-black', className)}>
        <video src={a.url} preload="metadata" muted playsInline className="h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white">
            <Play className="h-5 w-5 fill-current" />
          </span>
        </span>
      </button>
    );
  }
  if (a.kind === 'audio') {
    return <audio src={a.url} controls preload="metadata" className={cx('w-64 max-w-full', className)} />;
  }
  return (
    <a href={a.url} target="_blank" rel="noreferrer" className={cx('flex items-center gap-2 rounded-2xl bg-line px-3 py-2 text-sm', className)}>
      <FileText className="h-4 w-4" /> {a.fileName}
    </a>
  );
}

export function useLightbox() {
  const [item, setItem] = useState(null);
  const lightbox = (
    <Modal open={Boolean(item)} onClose={() => setItem(null)} title={item?.fileName ?? ''} wide>
      {item?.kind === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element -- private media
        <img src={item.url} alt={item.fileName} className="max-h-[75dvh] w-full rounded-2xl object-contain" />
      )}
      {item?.kind === 'video' && <video src={item.url} controls autoPlay playsInline className="max-h-[75dvh] w-full rounded-2xl bg-black" />}
    </Modal>
  );
  return { open: setItem, lightbox };
}

export function MediaGrid({ items, onOpen, className }) {
  if (!items?.length) return null;
  return (
    <div className={cx('grid gap-1.5', items.length === 1 ? 'grid-cols-1' : 'grid-cols-2', className)}>
      {items.map((a) => (
        <MediaThumb key={a.id} a={a} onOpen={onOpen} className={cx('rounded-2xl', a.kind === 'audio' || a.kind === 'file' ? '' : 'aspect-square')} />
      ))}
    </div>
  );
}
