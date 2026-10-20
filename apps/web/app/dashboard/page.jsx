'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Heart, Lock } from 'lucide-react';
import { useMe, useRelationships } from '@/lib/hooks';
import { ChatLayout } from '@/components/ChatLayout';
import { Button } from '@/components/ui';

function Welcome({ openCreate }) {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: spaces } = useRelationships();
  const isAdmin = Boolean(me?.user?.isAdmin);

  // Someone who belongs to exactly one space (e.g. your girlfriend) goes straight into it.
  useEffect(() => {
    if (!me?.user || isAdmin || !spaces) return;
    const open = spaces.filter((s) => s.status !== 'ended');
    if (open.length === 1) router.replace(`/r/${open[0].id}`);
  }, [me, isAdmin, spaces, router]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-10 text-center">
      <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Heart className="h-11 w-11 fill-current" />
      </span>
      <h2 className="font-display text-5xl">Our Little World</h2>
      <p className="max-w-md text-ink-soft">
        {isAdmin
          ? 'Pick a chat on the left to open that private space — messages, photos, memories, letters and surprises.'
          : 'Pick your chat on the left to open your private space.'}
      </p>
      {isAdmin && spaces?.length === 0 && <Button onClick={openCreate}>Start your first chat</Button>}
      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted">
        <Lock className="h-3.5 w-3.5" /> Every chat is a separate, private space. Nothing is shared between them.
      </p>
    </div>
  );
}

export default function DashboardPage() {
  return <ChatLayout chatOpen={false}>{({ openCreate }) => <Welcome openCreate={openCreate} />}</ChatLayout>;
}
