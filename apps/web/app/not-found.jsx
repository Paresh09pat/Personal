import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <h1 className="font-display text-6xl">Lost in love?</h1>
      <p className="text-ink-soft">This page doesn&apos;t exist — or it isn&apos;t yours to see.</p>
      <Link href="/dashboard" className="rounded-full bg-accent px-6 py-3 font-medium text-accent-ink">
        Back home
      </Link>
    </main>
  );
}
