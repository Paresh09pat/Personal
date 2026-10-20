'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, api, relUrl } from './api';
import { qk } from './queryKeys';

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return await api.get('/api/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useAuthConfig() {
  return useQuery({ queryKey: qk.authConfig, queryFn: () => api.get('/api/auth/config'), staleTime: Infinity });
}

export function useRelationships(enabled = true) {
  return useQuery({
    queryKey: qk.relationships,
    queryFn: async () => (await api.get('/api/relationships')).relationships,
    enabled,
  });
}

export function useSpaceDetail(rid) {
  return useQuery({
    queryKey: qk.relDetail(rid),
    queryFn: async () => (await api.get(relUrl(rid))).relationship,
    enabled: Boolean(rid),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
}

/** Generic list for a space section (memories, notes, letters, …). */
export function useSection(rid, kind, path = `/${kind}`, select = (d) => d) {
  return useQuery({
    queryKey: qk.section(rid, kind),
    queryFn: () => api.get(relUrl(rid, path)),
    enabled: Boolean(rid),
    select,
  });
}
