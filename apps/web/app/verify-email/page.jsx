'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { AuthCard } from '@/components/AuthCard';
import { ErrorText, Spinner } from '@/components/ui';

function Verify() {
  const token = useSearchParams().get('token');
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: token ? 'loading' : 'error', error: token ? null : new Error('This link is missing its token.') });
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api
      .post('/api/auth/verify-email', { token })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: qk.me });
        setState({ status: 'done' });
      })
      .catch((error) => setState({ status: 'error', error }));
  }, [token, queryClient]);

  return (
    <AuthCard title={state.status === 'done' ? 'Email confirmed 💗' : 'Confirming your email'}>
      {state.status === 'loading' && <Spinner />}
      {state.status === 'error' && <ErrorText error={state.error} />}
      {state.status !== 'loading' && (
        <Link href="/dashboard" className="mt-6 inline-block font-medium text-accent hover:underline">
          Continue to your spaces →
        </Link>
      )}
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
