'use client';

import { useEffect, useState } from 'react';
import { Heart, Loader2, X } from 'lucide-react';
import { initials } from '@/lib/format';

export const cx = (...c) => c.filter(Boolean).join(' ');

const VARIANTS = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 shadow-soft',
  soft: 'bg-accent-soft text-accent hover:brightness-95',
  ghost: 'text-ink-soft hover:bg-accent-soft hover:text-accent',
  outline: 'border border-line text-ink hover:border-accent hover:text-accent',
  danger: 'bg-danger text-white hover:brightness-110',
};

export function Button({ variant = 'primary', size = 'md', loading, className, children, ...props }) {
  const sizes = { sm: 'h-8 px-3 text-sm', md: 'h-11 px-5', lg: 'h-12 px-7 text-lg', icon: 'h-10 w-10 justify-center' };
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center gap-2 rounded-full font-medium transition disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        VARIANTS[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

/** Wraps its control in a <label>, so the control is labelled implicitly. */
export function Field({ label, hint, error, children }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-sm font-medium text-ink-soft">{label}</span>}
      {children}
      {error ? <span className="block text-sm text-danger">{error}</span> : hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const inputBase =
  'w-full rounded-2xl border border-line bg-surface-solid/70 px-4 py-3 text-ink placeholder:text-muted outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft';

export function Input({ className, ...props }) {
  return <input {...props} className={cx(inputBase, className)} />;
}

export function Textarea({ className, ...props }) {
  return <textarea {...props} className={cx(inputBase, 'min-h-28 resize-y', className)} />;
}

export function Select({ className, children, ...props }) {
  return (
    <select {...props} className={cx(inputBase, 'appearance-none', className)}>
      {children}
    </select>
  );
}

export function Card({ className, children, ...props }) {
  return (
    <div {...props} className={cx('glass rounded-3xl p-6', className)}>
      {children}
    </div>
  );
}

export function Avatar({ name, src, size = 40, online, className }) {
  // A photo that cannot be loaded (missing file, expired session) falls back to initials instead of a broken image.
  const [failedSrc, setFailedSrc] = useState(null);
  const showPhoto = Boolean(src) && failedSrc !== src;
  return (
    <span className={cx('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked media
        <img
          src={src}
          alt={name ?? ''}
          onError={() => setFailedSrc(src)}
          className="h-full w-full rounded-full object-cover ring-2 ring-surface-solid"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-accent to-gold font-display font-semibold text-white ring-2 ring-surface-solid"
          style={{ fontSize: size * 0.38 }}
          aria-hidden
        >
          {initials(name)}
        </span>
      )}
      {online !== undefined && (
        <span
          className={cx(
            'absolute bottom-0 right-0 block rounded-full ring-2 ring-surface-solid',
            online ? 'bg-emerald-500' : 'bg-zinc-400',
          )}
          style={{ width: size * 0.28, height: size * 0.28 }}
          title={online ? 'Online' : 'Offline'}
        />
      )}
    </span>
  );
}

export function Badge({ children, tone = 'accent', className }) {
  const tones = {
    accent: 'bg-accent text-accent-ink',
    soft: 'bg-accent-soft text-accent',
    muted: 'bg-line text-ink-soft',
    gold: 'bg-gold/15 text-gold',
  };
  return (
    <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center p-10 text-accent" role="status">
      <Heart className="h-7 w-7 animate-pulse fill-current" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon = Heart, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon className="h-7 w-7" aria-hidden />
      </span>
      <h3 className="font-display text-2xl">{title}</h3>
      {children && <p className="max-w-sm text-ink-soft">{children}</p>}
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-label="Close dialog" />
      <div
        className={cx(
          'glass animate-pop-in relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-surface-solid p-6 scrollbar-thin sm:rounded-3xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-3xl leading-tight">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-accent-soft hover:text-accent" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorText({ error }) {
  if (!error) return null;
  return (
    <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
      {error.message ?? String(error)}
    </p>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
