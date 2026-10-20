'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/components/Toast';
import { SocketProvider } from '@/components/SocketProvider';
import { CallLayer } from '@/components/CallLayer';

export function Providers({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiError && [401, 403, 404].includes(err.status)) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SocketProvider>
          <CallLayer>{children}</CallLayer>
        </SocketProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
