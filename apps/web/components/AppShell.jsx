'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { RequireAuth } from './RequireAuth';
import { Logo } from './Logo';

/** Simple signed-in page frame (account, onboarding). Chats use ChatLayout instead. */
export function AppShell({ children, back = true }) {
  return (
    <RequireAuth>
      <header className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
        {back && (
          <Link href="/dashboard" className="rounded-full p-2 text-ink-soft hover:bg-accent-soft hover:text-accent" aria-label="Back to chats">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        )}
        <Logo href="/dashboard" />
      </header>
      {children}
    </RequireAuth>
  );
}
