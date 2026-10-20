'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import { Spinner } from './ui';

/** Client-side gate for signed-in pages. The server still authorises every request on its own. */
export function RequireAuth({ children }) {
  const { data, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && data === null) {
      // Stale cookie: clear it so the optimistic proxy redirect doesn't loop.
      api.post('/api/auth/logout').finally(() => router.replace(`/login?next=${encodeURIComponent(pathname)}`));
    }
  }, [isLoading, data, router, pathname]);

  if (isLoading || !data) return <Spinner />;
  return children;
}
