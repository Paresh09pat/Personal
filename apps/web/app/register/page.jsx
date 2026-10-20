'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { LIMITS } from '@olw/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { safeNext } from '@/lib/nav';
import { useAuthConfig } from '@/lib/hooks';
import { AuthCard } from '@/components/AuthCard';
import { Button, ErrorText, Field, Input } from '@/components/ui';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { data: authConfig } = useAuthConfig();
  const invite = params.get('invite');
  const next = params.get('next');
  const [form, setForm] = useState({ email: '', username: '', displayName: '', password: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const me = await api.post('/api/auth/register', { ...form, ...(invite ? { inviteToken: invite } : {}) });
      queryClient.clear();
      queryClient.setQueryData(qk.me, me);
      router.replace(
        invite ? `/invite/${encodeURIComponent(invite)}` : me.user.isAdmin ? '/onboarding' : safeNext(next, '/dashboard'),
      );
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  };

  const inviteOnly = authConfig?.registrationMode === 'invite_only' && !invite;

  return (
    <AuthCard
      title={invite ? 'You were invited 💌' : 'Create your account'}
      subtitle={invite ? 'Create an account to accept your invitation.' : 'One account, as many private little worlds as your heart holds.'}
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-medium text-accent hover:underline" href={invite ? `/login?next=/invite/${invite}` : '/login'}>
            Sign in
          </Link>
        </>
      }
    >
      {inviteOnly && (
        <p className="mb-4 rounded-2xl bg-accent-soft px-4 py-3 text-sm text-accent">
          Sign-up on this site is by invitation. Open the invite link your partner sent you.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name">
          <Input required maxLength={LIMITS.displayName} autoComplete="name" value={form.displayName} onChange={set('displayName')} />
        </Field>
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Username" hint="Letters, numbers, dots and underscores">
          <Input required minLength={3} maxLength={30} pattern="[a-zA-Z0-9_.]+" autoComplete="username" value={form.username} onChange={set('username')} />
        </Field>
        <Field label="Password" hint={`At least ${LIMITS.password.min} characters — a phrase works beautifully`}>
          <Input type="password" required minLength={LIMITS.password.min} autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" loading={loading} className="w-full justify-center">
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
