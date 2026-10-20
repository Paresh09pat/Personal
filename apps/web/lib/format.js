const DAY = 24 * 60 * 60 * 1000;

export const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const fmtDate = (d, opts = { day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Date(d).toLocaleDateString([], opts);

export function fmtRelative(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return fmtDate(d, { day: 'numeric', month: 'short' });
}

export function dayLabel(d) {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(Date.now() - DAY);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
}

export const daysBetween = (a, b) =>
  Math.floor((new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / DAY);

/** Next yearly occurrence of a date (today counts). */
export function nextOccurrence(d) {
  const src = new Date(d);
  const now = new Date();
  const next = new Date(now.getFullYear(), src.getMonth(), src.getDate());
  if (daysBetween(now, next) < 0) next.setFullYear(now.getFullYear() + 1);
  return next;
}

export const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export function toLocalDateTimeInput(d) {
  if (!d) return '';
  const date = new Date(d);
  const off = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - off).toISOString().slice(0, 16);
}

export const fmtDuration = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export const initials = (name = '?') =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
