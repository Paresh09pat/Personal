'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITS } from '@olw/shared';
import { Laptop, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useMe } from '@/lib/hooks';
import { fmtRelative } from '@/lib/format';
import { AppShell } from '@/components/AppShell';
import { ConfirmWithPassword } from '@/components/ConfirmWithPassword';
import { useToast } from '@/components/Toast';
import { Button, Card, ErrorText, Field, Input, PageHeader } from '@/components/ui';

function Account() {
  const { data: me } = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(me.user.displayName);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: () => api.get('/api/auth/sessions') });

  const run = async (fn, ok) => {
    setError(null);
    try {
      await fn();
      toast(ok);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 pb-20">
      <PageHeader title="Your account" subtitle={`${me.user.email} · @${me.user.username}`} />
      <ErrorText error={error} />
      <Card className="space-y-4">
        <h2 className="font-display text-3xl">Profile</h2>
        <Field label="Display name" hint="Used wherever you haven't set a space-specific name.">
          <Input value={name} maxLength={LIMITS.displayName} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button
          onClick={() =>
            run(async () => {
              await api.patch('/api/auth/me', { displayName: name });
              queryClient.invalidateQueries({ queryKey: qk.me });
            }, 'Saved 💗')
          }
        >
          Save
        </Button>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-display text-3xl">Password</h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.post('/api/auth/change-password', pw);
              setPw({ currentPassword: '', newPassword: '' });
              sessions.refetch();
            }, 'Password changed. Other devices were signed out.');
          }}
        >
          <Field label="Current password">
            <Input type="password" required autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </Field>
          <Field label="New password" hint={`At least ${LIMITS.password.min} characters`}>
            <Input type="password" required minLength={LIMITS.password.min} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </Field>
          <Button type="submit">Change password</Button>
        </form>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-display text-3xl">Signed-in devices</h2>
        {sessions.data?.sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
            <Laptop className="h-5 w-5 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{s.userAgent || 'Unknown device'}</p>
              <p className="text-xs text-muted">
                {s.current ? 'This device' : `Active ${fmtRelative(s.lastSeenAt)}`} · {s.ip}
              </p>
            </div>
            {!s.current && (
              <Button size="sm" variant="ghost" onClick={() => run(async () => { await api.delete(`/api/auth/sessions/${s.id}`); sessions.refetch(); }, 'Signed out that device')}>
                Sign out
              </Button>
            )}
          </div>
        ))}
      </Card>

      <Card className="space-y-3 border-danger/30">
        <h2 className="font-display text-3xl text-danger">Delete account</h2>
        <p className="text-sm text-ink-soft">
          Your spaces will be ended (your partners keep their copy of your shared history, shown as “Deleted user”),
          your unpublished surprises and private files are erased, and your profile is anonymised. See the data
          policy in docs/DATA-RETENTION.md.
        </p>
        <Button variant="danger" onClick={() => setDeleting(true)}>
          <Trash2 className="h-4 w-4" /> Delete my account
        </Button>
      </Card>

      <ConfirmWithPassword
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete your account?"
        phrase="DELETE"
        actionLabel="Delete forever"
        description={<p>This cannot be undone.</p>}
        onConfirm={async (body) => {
          await api.post('/api/auth/delete-account', body);
          queryClient.clear();
          router.replace('/');
        }}
      />
    </main>
  );
}

export default function AccountPage() {
  return (
    <AppShell>
      <Account />
    </AppShell>
  );
}
