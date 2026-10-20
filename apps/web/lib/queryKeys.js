/**
 * Every relationship-scoped query key starts with ['rel', rid] so that switching spaces can drop the
 * previous space's entire cache in one call and nothing can be served from the wrong space.
 */
export const qk = {
  me: ['me'],
  authConfig: ['auth-config'],
  relationships: ['relationships'],
  sessions: ['sessions'],
  rel: (rid) => ['rel', rid],
  relDetail: (rid) => ['rel', rid, 'detail'],
  messages: (rid) => ['rel', rid, 'messages'],
  section: (rid, kind) => ['rel', rid, kind],
};

/** Server "content:changed" kinds → the query that should refresh. */
export const CONTENT_KINDS = ['gallery', 'albums', 'memories', 'notes', 'letters', 'surprises', 'milestones', 'calls', 'notifications'];
