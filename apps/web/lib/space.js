/** Name shown for a space: your partner's name once they joined, otherwise the name you gave the chat. */
export const spaceName = (r) => r?.partner?.displayName || r?.title || 'New chat';

export function spaceSubtitle(r) {
  if (!r) return '';
  if (r.status === 'pending') return 'Invite sent · waiting to join';
  if (r.status === 'archived') return 'Archived';
  if (r.status === 'ended') return 'Ended';
  if (!r.lastMessage) return 'Say hello 💌';
  return `${r.lastMessage.senderId === r.me.userId ? 'You: ' : ''}${r.lastMessage.preview}`;
}

/** WhatsApp-style timestamp: time today, "Yesterday", weekday this week, else date. */
export function listTime(d) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
