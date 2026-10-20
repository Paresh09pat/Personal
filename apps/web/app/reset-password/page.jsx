'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { LIMITS } from '@olw/shared';
import { api } from '@/lib/api';
import { AuthCard } from '@/components/AuthCard';
import { Button, ErrorText, Field, Input } from '@/components/ui';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <div className="space-y-4">
          <p className="rounded-2xl bg-accent-soft px-4 py-3 text-accent">Your password was changed. All other sessions were signed out.</p>
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in →
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password" hint={`At least ${LIMITS.password.min} characters`}>
            <Input type="password" required minLength={LIMITS.password.min} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" loading={loading} className="w-full justify-center">
            Save new password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
