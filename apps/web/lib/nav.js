/** Only allow same-site relative redirects (prevents open-redirect via ?next=). */
export const safeNext = (next, fallback = '/dashboard') =>
  typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
