'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AuthCard } from '@/components/AuthCard';
import { Button, ErrorText, Field, Input } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setSent((await api.post('/api/auth/forgot-password', { email })).message);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Forgot your password?" subtitle="We'll send you a link to choose a new one." footer={<Link href="/login" className="text-accent hover:underline">Back to sign in</Link>}>
      {sent ? (
        <p className="rounded-2xl bg-accent-soft px-4 py-3 text-accent">{sent}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" loading={loading} className="w-full justify-center">
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
