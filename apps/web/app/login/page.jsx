'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { safeNext } from '@/lib/nav';
import { AuthCard } from '@/components/AuthCard';
import { Button, ErrorText, Field, Input } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const next = safeNext(params.get('next'));

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const me = await api.post('/api/auth/login', form);
      queryClient.clear();
      queryClient.setQueryData(qk.me, me);
      router.replace(me.user.isAdmin && !me.user.onboarded && next === '/dashboard' ? '/onboarding' : next);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Your little worlds have missed you."
      footer={
        <>
          New here?{' '}
          <Link className="font-medium text-accent hover:underline" href={`/register${next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''}`}>
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email or username">
          <Input autoComplete="username" required value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" loading={loading} className="w-full justify-center">
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="text-ink-soft hover:text-accent">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
