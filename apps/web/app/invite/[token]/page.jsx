'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { HeartHandshake } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useMe } from '@/lib/hooks';
import { fmtDate } from '@/lib/format';
import { AuthCard } from '@/components/AuthCard';
import { Button, ErrorText, Spinner } from '@/components/ui';

export default function InvitePage() {
  const { token } = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading } = useMe();
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .post('/api/invitations/preview', { token })
      .then((r) => setPreview(r.invitation))
      .catch(setError);
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const { relationship } = await api.post('/api/invitations/accept', { token });
      await api.patch('/api/auth/me', { onboarded: true }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: qk.relationships });
      queryClient.invalidateQueries({ queryKey: qk.me });
      router.replace(`/r/${relationship.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const decline = async () => {
    await api.post('/api/invitations/decline', { token }).catch(() => {});
    router.replace('/dashboard');
  };

  const next = encodeURIComponent(`/invite/${token}`);

  return (
    <AuthCard title={preview ? `${preview.inviterName} invited you` : 'Your invitation'}>
      {!preview && !error && <Spinner />}
      {preview && (
        <div className="space-y-5">
          <div className="flex items-center gap-4 rounded-2xl bg-accent-soft p-4 text-accent">
            <HeartHandshake className="h-8 w-8 shrink-0" />
            <p>
              {preview.kind === 'group' ? (
                <>
                  Join the group <strong>{preview.spaceTitle}</strong>: a private space with {preview.memberCount}{' '}
                  {preview.memberCount === 1 ? 'person' : 'people'} so far. This link expires {fmtDate(preview.expiresAt)}.
                </>
              ) : (
                <>
                  Join <strong>{preview.spaceTitle || 'their little world'}</strong> — a private space just for the two of
                  you. This invitation expires {fmtDate(preview.expiresAt)}.
                </>
              )}
            </p>
          </div>
          {meLoading ? (
            <Spinner />
          ) : me?.user ? (
            <div className="flex flex-col gap-2">
              <Button size="lg" className="justify-center" loading={busy} onClick={accept}>
                Accept as {me.user.displayName}
              </Button>
              <Button variant="ghost" className="justify-center" onClick={decline}>
                Decline
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Link href={`/register?invite=${encodeURIComponent(token)}`} className="rounded-full bg-accent py-3 text-center font-medium text-accent-ink">
                Create an account to accept
              </Link>
              <Link href={`/login?next=${next}`} className="rounded-full border border-line py-3 text-center font-medium">
                I already have an account
              </Link>
            </div>
          )}
        </div>
      )}
      <div className="mt-4">
        <ErrorText error={error} />
      </div>
    </AuthCard>
  );
}
