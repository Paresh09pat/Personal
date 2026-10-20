'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useMe } from '@/lib/hooks';
import { AppShell } from '@/components/AppShell';
import { CreateSpaceFlow } from '@/components/CreateSpaceModal';
import { Button, Card } from '@/components/ui';

/** First-run welcome for the site owner (admin). Everyone else goes straight to their chats. */
function Onboarding() {
  const { data: me } = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const isAdmin = Boolean(me?.user?.isAdmin);

  useEffect(() => {
    if (me?.user && !isAdmin) router.replace('/dashboard');
  }, [me, isAdmin, router]);

  const finish = async (space) => {
    await api.patch('/api/auth/me', { onboarded: true });
    queryClient.invalidateQueries({ queryKey: qk.me });
    queryClient.invalidateQueries({ queryKey: qk.relationships });
    router.replace(space ? `/r/${space.id}` : '/dashboard');
  };

  if (!isAdmin) return null;

  return (
    <main className="mx-auto max-w-xl px-4 pb-20">
      <Card className="animate-pop-in p-8">
        {step === 0 ? (
          <div className="space-y-5 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-ink shadow-soft">
              <Heart className="h-7 w-7 fill-current" />
            </span>
            <h1 className="font-display text-5xl">Welcome, {me.user.displayName}</h1>
            <p className="text-ink-soft">
              You&apos;re the owner of this site. Start a chat, send its private invite link, and that person gets their
              own separate space with you: chat, photos, memories, letters and surprises. Each chat is completely
              private from the others.
            </p>
            <div className="flex flex-col gap-3">
              <Button size="lg" className="justify-center" onClick={() => setStep(1)}>
                Start my first chat
              </Button>
              <Button variant="ghost" className="justify-center" onClick={() => finish(null)}>
                Skip for now
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <h1 className="font-display text-4xl">New chat</h1>
            <CreateSpaceFlow myName={me.user.displayName} onDone={finish} />
          </div>
        )}
      </Card>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <AppShell back={false}>
      <Onboarding />
    </AppShell>
  );
}
