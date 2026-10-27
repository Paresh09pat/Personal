export const isGroupSpace = (r) => r?.kind === 'group';

/** Name shown for a space: the group's name, or (1:1) your partner's name once they joined, otherwise the name you gave the chat. */
export const spaceName = (r) => (isGroupSpace(r) ? r.title || 'Group' : r?.partner?.displayName || r?.title || 'New chat');

/** Picture for a space: the group photo, or your partner's photo. */
export const spaceAvatar = (r) => (isGroupSpace(r) ? r.coverUrl : r?.partner?.avatarUrl);

export function spaceSubtitle(r) {
  if (!r) return '';
  if (r.status === 'pending') return 'Invite sent · waiting to join';
  if (r.status === 'archived') return 'Archived';
  if (r.status === 'ended') return 'Ended';
  if (!r.lastMessage) return isGroupSpace(r) ? 'Say hi to the group 👋' : 'Say hello 💌';
  const { senderId, senderName, preview } = r.lastMessage;
  if (senderId === r.me.userId) return `You: ${preview}`;
  return isGroupSpace(r) && senderName ? `${senderName}: ${preview}` : preview;
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

/** A stable, readable colour per person, used for sender names inside group chats. */
export function nameColor(userId = '') {
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) h = (h * 31 + userId.charCodeAt(i)) % 360;
  return `hsl(${h} 65% 42%)`;
}

/** "Uma", "Uma and Vik", "Uma, Vik and 2 others" */
export function joinNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 === 1 ? '' : 's'}`;
}
