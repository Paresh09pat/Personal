import { Logo } from './Logo';

export function AuthCard({ title, subtitle, children, footer }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="glass animate-pop-in w-full max-w-md rounded-[2rem] p-8">
        <h1 className="font-display text-4xl leading-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-ink-soft">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-6 text-sm text-ink-soft">{footer}</div>}
    </main>
  );
}
