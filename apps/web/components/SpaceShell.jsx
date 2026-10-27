'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarHeart,
  Gift,
  Images,
  Lock,
  Mail,
  MessageCircleHeart,
  NotebookPen,
  Phone,
  Settings,
  Sparkles,
  Video,
} from 'lucide-react';
import { EVENTS } from '@olw/shared';
import { ApiError } from '@/lib/api';
import { useSpaceDetail } from '@/lib/hooks';
import { CONTENT_KINDS, qk } from '@/lib/queryKeys';
import { belongsToSpace, clearSpaceCache, upsertMessage } from '@/lib/spaceCache';
import { useSocket } from './SocketProvider';
import { useCall } from './CallLayer';
import { isGroupSpace, joinNames, spaceAvatar, spaceName } from '@/lib/space';
import { InvitePanel } from './InvitePanel';
import { themeVars } from '@/lib/chatThemes';
import { Avatar, Card, EmptyState, Spinner, cx } from './ui';

const SpaceContext = createContext(null);
export const useSpace = () => useContext(SpaceContext);

const TABS = [
  { href: '', label: 'Chat', icon: MessageCircleHeart },
  { href: '/gallery', label: 'Gallery', icon: Images },
  { href: '/memories', label: 'Memories', icon: Sparkles },
  { href: '/notes', label: 'Notes', icon: NotebookPen },
  { href: '/letters', label: 'Letters', icon: Mail },
  { href: '/surprises', label: 'Surprises', icon: Gift },
  { href: '/milestones', label: 'Dates', icon: CalendarHeart },
  { href: '/calls', label: 'Calls', icon: Phone },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Everything inside /r/[rid]. Rendered with key={rid}, so switching spaces fully remounts it:
 *  - the previous space's socket room is left and its whole query cache is removed;
 *  - realtime events are applied only if payload.relationshipId === rid;
 *  - access is (re)validated by the server: a 404 means "not yours", whatever the URL says.
 */
export function SpaceShell({ rid, children }) {
  const socket = useSocket();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { startCall, busy } = useCall();
  const { data: space, error, isLoading } = useSpaceDetail(rid);
  const [online, setOnline] = useState([]);
  const [typingIds, setTypingIds] = useState([]);
  const typingTimers = useRef(new Map());
  const router = useRouter();

  // Group chats have no calls, letters or surprises: bounce anyone who types those URLs.
  useEffect(() => {
    if (space && isGroupSpace(space) && /\/(calls|letters|surprises)$/.test(pathname)) router.replace(`/r/${rid}`);
  }, [space, pathname, rid, router]);
  useEffect(() => {
    const timers = typingTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // Leaving this space (switch or navigate away): drop all of its cached data.
  useEffect(() => () => clearSpaceCache(queryClient, rid), [queryClient, rid]);

  useEffect(() => {
    if (!socket || !space) return undefined;
    const join = () =>
      socket.timeout(5000).emitWithAck(EVENTS.RELATIONSHIP_JOIN, { relationshipId: rid }).then(
        (res) => res?.ok && setOnline(res.online ?? []),
        () => {},
      );
    join();
    socket.on('connect', join);

    const only = (fn) => (payload) => belongsToSpace(rid, payload) && fn(payload);
    const onMessage = only(({ message }) => {
      queryClient.setQueryData(qk.messages(rid), (old) => upsertMessage(old, message));
      queryClient.invalidateQueries({ queryKey: qk.relationships });
      if (message.attachments?.length) queryClient.invalidateQueries({ queryKey: qk.section(rid, 'gallery') });
    });
    const onTyping = only((p) => {
      clearTimeout(typingTimers.current.get(p.userId));
      if (p.isTyping) {
        setTypingIds((list) => (list.includes(p.userId) ? list : [...list, p.userId]));
        // A "stopped typing" event can get lost, so everyone's indicator expires on its own.
        typingTimers.current.set(p.userId, setTimeout(() => setTypingIds((list) => list.filter((u) => u !== p.userId)), 6000));
      } else {
        setTypingIds((list) => list.filter((u) => u !== p.userId));
      }
    });
    const onPresence = only((p) => setOnline((list) => (p.online ? [...new Set([...list, p.userId])] : list.filter((u) => u !== p.userId))));
    const onRead = only(() => queryClient.invalidateQueries({ queryKey: qk.relDetail(rid) }));
    const onContent = only(({ kind }) => CONTENT_KINDS.includes(kind) && queryClient.invalidateQueries({ queryKey: qk.section(rid, kind) }));
    const onUpdated = only(() => {
      queryClient.invalidateQueries({ queryKey: qk.relDetail(rid) });
      queryClient.invalidateQueries({ queryKey: qk.relationships });
    });
    const onCallEnded = only(() => queryClient.invalidateQueries({ queryKey: qk.section(rid, 'calls') }));

    socket.on(EVENTS.MESSAGE_NEW, onMessage);
    socket.on(EVENTS.MESSAGE_UPDATED, onMessage);
    socket.on(EVENTS.TYPING, onTyping);
    socket.on(EVENTS.PRESENCE, onPresence);
    socket.on(EVENTS.READ_UPDATED, onRead);
    socket.on(EVENTS.CONTENT_CHANGED, onContent);
    socket.on(EVENTS.RELATIONSHIP_UPDATED, onUpdated);
    socket.on(EVENTS.CALL_ENDED, onCallEnded);
    return () => {
      socket.emit(EVENTS.RELATIONSHIP_LEAVE, { relationshipId: rid });
      socket.off('connect', join);
      socket.off(EVENTS.MESSAGE_NEW, onMessage);
      socket.off(EVENTS.MESSAGE_UPDATED, onMessage);
      socket.off(EVENTS.TYPING, onTyping);
      socket.off(EVENTS.PRESENCE, onPresence);
      socket.off(EVENTS.READ_UPDATED, onRead);
      socket.off(EVENTS.CONTENT_CHANGED, onContent);
      socket.off(EVENTS.RELATIONSHIP_UPDATED, onUpdated);
      socket.off(EVENTS.CALL_ENDED, onCallEnded);
    };
  }, [socket, rid, queryClient, Boolean(space)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <Spinner />;
  if (error || !space) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={Lock} title="This chat isn't available" action={<Link href="/dashboard" className="font-medium text-accent">Back to chats</Link>}>
          {error instanceof ApiError && error.status === 404
            ? "It doesn't exist, or it isn't one of yours."
            : 'Something went wrong loading this chat.'}
        </EmptyState>
      </div>
    );
  }

  const group = isGroupSpace(space);
  const partnerOnline = space.partner ? online.includes(space.partner.userId) : false;
  const writable = space.status === 'active';
  const base = `/r/${rid}`;
  const isChat = pathname === base;
  // Everyone in this space (me included), looked up by user id. Works the same for 1:1 and groups.
  const members = group ? (space.members ?? []) : [space.me, space.partner].filter(Boolean);
  const membersById = new Map(members.map((m) => [m.userId, m]));
  const others = members.filter((m) => m.userId !== space.me.userId);
  const typingNames = typingIds.map((id) => membersById.get(id)?.displayName).filter(Boolean);
  const typing = typingNames.length > 0;
  const onlineOthers = others.filter((m) => online.includes(m.userId)).length;
  const value = { rid, space, kind: space.kind, isGroup: group, members, membersById, others, typing, typingNames, partnerOnline, writable, me: space.me, partner: space.partner };
  const tabs = group ? TABS.filter((t) => !['/letters', '/surprises', '/calls'].includes(t.href)) : TABS;
  const status = typing ? (
    <span className="text-accent">{group ? `${joinNames(typingNames)} ${typingNames.length > 1 ? 'are' : 'is'} typing…` : 'typing…'}</span>
  ) : group ? (
    `${members.length} member${members.length === 1 ? '' : 's'}${onlineOthers ? ` · ${onlineOthers} online` : ''}`
  ) : space.status === 'pending' ? (
    'Waiting to join'
  ) : space.status !== 'active' ? (
    space.status === 'archived' ? 'Archived' : 'Ended'
  ) : partnerOnline ? (
    'online'
  ) : (
    'Private space'
  );

  return (
    <SpaceContext.Provider value={value}>
      <div data-accent={space.preferences?.accent} style={themeVars(space.preferences)} className="flex h-full min-h-0 flex-col">
        {/* Header — like a WhatsApp chat header */}
        <header className="flex items-center gap-2 border-b border-line bg-surface-solid/80 px-2 py-2 sm:px-4">
          <Link href="/dashboard" className="rounded-full p-2 text-ink-soft hover:bg-accent-soft md:hidden" aria-label="Back to chats">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Link href={`${base}/settings`} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1 py-1 hover:bg-accent-soft/50">
            <Avatar name={spaceName(space)} src={spaceAvatar(space)} size={44} online={!group && space.partnerActive ? partnerOnline : undefined} />
            <span className="min-w-0">
              <span className="block truncate text-[17px] font-semibold leading-tight">{spaceName(space)}</span>
              <span className="block truncate text-xs text-muted">{status}</span>
            </span>
          </Link>
          {writable && !group && space.partnerActive && (
            <div className="flex">
              <button disabled={busy} onClick={() => startCall(rid, 'video', spaceName(space))} className="rounded-full p-2.5 text-accent hover:bg-accent-soft disabled:opacity-40" aria-label="Video call">
                <Video className="h-5 w-5" />
              </button>
              <button disabled={busy} onClick={() => startCall(rid, 'audio', spaceName(space))} className="rounded-full p-2.5 text-accent hover:bg-accent-soft disabled:opacity-40" aria-label="Voice call">
                <Phone className="h-5 w-5" />
              </button>
            </div>
          )}
        </header>

        {/* Sections of this one space */}
        <nav className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-line px-2 py-2 sm:px-4" aria-label="Sections of this chat">
          {tabs.map(({ href, label, icon: Icon }) => {
            const to = `${base}${href}`;
            const active = href === '' ? isChat : pathname.startsWith(to);
            return (
              <Link
                key={label}
                href={to}
                className={cx(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition',
                  active ? 'bg-accent text-accent-ink shadow-soft' : 'text-ink-soft hover:bg-accent-soft hover:text-accent',
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </Link>
            );
          })}
        </nav>

        <div className={cx('min-h-0 flex-1', isChat ? 'flex flex-col' : 'scrollbar-thin overflow-y-auto p-4 sm:p-6')}>
          {space.status === 'pending' && (
            <Card className={cx('mb-4', isChat && 'm-4')}>
              <h2 className="mb-1 font-display text-2xl">Waiting for {space.title || 'them'} to join 💌</h2>
              <p className="mb-4 text-sm text-ink-soft">This chat unlocks as soon as they open your private invite link and accept.</p>
              {space.me.role === 'owner' && <InvitePanel rid={rid} />}
            </Card>
          )}
          {(space.status === 'archived' || space.status === 'ended') && (
            <p className={cx('mb-4 flex items-center gap-2 rounded-2xl bg-line px-4 py-3 text-sm text-ink-soft', isChat && 'm-4 mb-0')}>
              <Lock className="h-4 w-4" />
              {space.status === 'archived'
                ? 'This chat is archived and read-only. Unarchive it in Settings to continue.'
                : 'This chat has ended. It is read-only; you can still look back and export it.'}
            </p>
          )}
          {children}
        </div>
      </div>
    </SpaceContext.Provider>
  );
}
