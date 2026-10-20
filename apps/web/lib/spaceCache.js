import { qk } from './queryKeys';

/** Realtime events are only applied when they belong to the space currently on screen. */
export const belongsToSpace = (rid, payload) =>
  Boolean(rid && payload && typeof payload.relationshipId === 'string' && payload.relationshipId === rid);

/** Drop every cached query of a space (called when leaving/switching it). */
export function clearSpaceCache(queryClient, rid) {
  if (!rid) return;
  queryClient.cancelQueries({ queryKey: qk.rel(rid) });
  queryClient.removeQueries({ queryKey: qk.rel(rid) });
}

/** Insert or replace a message in the infinite-query cache (pages[0] = newest page). */
export function upsertMessage(data, message) {
  if (!data?.pages?.length) return data;
  let found = false;
  const pages = data.pages.map((page) => ({
    ...page,
    messages: page.messages.map((m) => {
      if (m.id === message.id || (m.clientId && m.clientId === message.clientId && m.senderId === message.senderId)) {
        found = true;
        return message;
      }
      return m;
    }),
  }));
  if (!found) pages[0] = { ...pages[0], messages: [...pages[0].messages, message] };
  return { ...data, pages };
}

/** Flatten infinite pages into chronological order, defensively filtered to the current space. */
export const flattenMessages = (data, rid) =>
  (data?.pages ?? [])
    .slice()
    .reverse()
    .flatMap((p) => p.messages)
    .filter((m) => m.relationshipId === rid);
