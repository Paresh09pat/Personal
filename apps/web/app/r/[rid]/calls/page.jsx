'use client';

import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react';
import { useSection } from '@/lib/hooks';
import { fmtDate, fmtDuration, fmtTime } from '@/lib/format';
import { useSpace } from '@/components/SpaceShell';
import { useCall } from '@/components/CallLayer';
import { spaceName } from '@/lib/space';
import { Button, Card, EmptyState, Spinner } from '@/components/ui';

export default function CallsPage() {
  const { rid, writable, space, me } = useSpace();
  const { startCall, busy } = useCall();
  const { data, isLoading } = useSection(rid, 'calls');
  if (isLoading) return <Spinner />;
  const items = data?.items ?? [];
  const canCall = writable && space.partnerActive;

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl">Hear each other</h2>
          <p className="text-sm text-ink-soft">Private calls inside this space, peer-to-peer and encrypted by WebRTC.</p>
        </div>
        {canCall && (
          <div className="flex gap-2">
            <Button variant="soft" disabled={busy} onClick={() => startCall(rid, 'audio', spaceName(space))}>
              <Phone className="h-4 w-4" /> Voice
            </Button>
            <Button disabled={busy} onClick={() => startCall(rid, 'video', spaceName(space))}>
              <Video className="h-4 w-4" /> Video
            </Button>
          </div>
        )}
      </Card>
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={Phone} title="No calls yet">Your call history in this space will appear here.</EmptyState>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-2">
          {items.map((c) => {
            const outgoing = c.callerId === me.userId;
            const missed = ['missed', 'declined'].includes(c.status);
            const Icon = missed ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
            return (
              <div key={c.id} className="flex items-center gap-3 px-3 py-3">
                <Icon className={`h-5 w-5 ${missed ? 'text-danger' : 'text-accent'}`} />
                <div className="flex-1">
                  <p className="font-medium capitalize">
                    {outgoing ? 'Outgoing' : 'Incoming'} {c.kind} call {missed && `· ${c.status}`}
                  </p>
                  <p className="text-xs text-muted">
                    {fmtDate(c.createdAt, { day: 'numeric', month: 'short' })} at {fmtTime(c.createdAt)}
                  </p>
                </div>
                {c.durationSec > 0 && <span className="text-sm tabular-nums text-ink-soft">{fmtDuration(c.durationSec)}</span>}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
