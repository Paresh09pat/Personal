'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, CheckCheck, Copy, CornerUpLeft, Paperclip, Pencil, Send, Timer, Trash2, X } from 'lucide-react';
import { EVENTS, REACTIONS } from '@olw/shared';
import { api, relUrl } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { dayLabel, fmtTime } from '@/lib/format';
import { chatBackgroundStyle, describeSeconds, themeFx } from '@/lib/chatThemes';
import { flattenMessages, upsertMessage } from '@/lib/spaceCache';
import { uploadToSpace } from '@/lib/upload';
import { useSocket } from './SocketProvider';
import { useSpace } from './SpaceShell';
import { useToast } from './Toast';
import { MediaGrid, useLightbox } from './Media';
import { VoiceRecorder } from './VoiceRecorder';
import { ThemeFx } from './ThemeFx';
import { nameColor } from '@/lib/space';
import { Avatar, Button, EmptyState, Spinner, cx } from './ui';

const newClientId = () => crypto.randomUUID();
const SWIPE_TRIGGER = 56;
const LONG_PRESS_MS = 420;
const buzz = (ms = 12) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
};
const previewOf = (m) => (m.deleted ? 'Message removed' : m.body || (m.attachments?.length ? '📎 Attachment' : ''));

/** Bottom sheet on phones, centred card on desktop: react + actions for one message. */
function MessageSheet({ m, mine, meId, accent, writable, onClose, onReply, onEdit, onDelete, onReact, onCopy }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const myEmoji = m.reactions.find((r) => r.userId === meId)?.emoji;
  const act = (fn) => () => {
    onClose();
    fn(m);
  };
  const item = 'flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[15px] hover:bg-accent-soft';
  return createPortal(
    <div data-accent={accent} className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Message actions">
      <button className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-label="Close" />
      <div className="animate-pop-in relative w-full max-w-sm space-y-2 rounded-t-3xl bg-surface-solid p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-ink shadow-soft sm:rounded-3xl">
        <div className="mx-auto h-1 w-10 rounded-full bg-line sm:hidden" />
        {writable && (
          <div className="flex justify-between rounded-full bg-accent-soft px-2 py-1.5">
            {REACTIONS.map((e) => (
              <button
                key={e}
                onClick={act((msg) => onReact(msg, e))}
                className={cx('rounded-full p-1.5 text-2xl transition active:scale-125 hover:scale-125', myEmoji === e && 'bg-surface-solid ring-2 ring-accent')}
                aria-label={`React ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <p className="line-clamp-2 rounded-2xl bg-line/40 px-4 py-2 text-sm text-ink-soft">{previewOf(m)}</p>
        <div>
          {writable && (
            <button className={item} onClick={act(onReply)}>
              <CornerUpLeft className="h-5 w-5 text-accent" /> Reply
            </button>
          )}
          {m.body && (
            <button className={item} onClick={act(onCopy)}>
              <Copy className="h-5 w-5 text-accent" /> Copy text
            </button>
          )}
          {writable && mine && m.body && (
            <button className={item} onClick={act(onEdit)}>
              <Pencil className="h-5 w-5 text-accent" /> Edit
            </button>
          )}
          {writable && mine && (
            <button className={cx(item, 'text-danger')} onClick={act(onDelete)}>
              <Trash2 className="h-5 w-5" /> Delete for both
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Bubble({ m, mine, meId, accent, seen, replyTo, replyName, sender, showSender, isGroup, flash, onReply, onEdit, onDelete, onReact, onOpen, onJump, onCopy, writable }) {
  const [sheet, setSheet] = useState(false);
  const [dx, setDx] = useState(0);
  const touch = useRef({ x: 0, y: 0, lock: null, timer: 0, lastTap: 0, fired: false });
  const canAct = !m.deleted;
  const canReply = writable && canAct;
  const grouped = Object.entries(m.reactions.reduce((acc, r) => ({ ...acc, [r.emoji]: (acc[r.emoji] ?? 0) + 1 }), {}));
  const mineReacted = (emoji) => m.reactions.some((r) => r.userId === meId && r.emoji === emoji);

  const heart = () => {
    if (!writable || !canAct || mineReacted('❤️')) return;
    buzz(10);
    onReact(m, '❤️');
  };

  const onTouchStart = (e) => {
    if (!canAct || e.touches.length !== 1) return;
    const t = touch.current;
    t.x = e.touches[0].clientX;
    t.y = e.touches[0].clientY;
    t.lock = null;
    t.fired = false;
    clearTimeout(t.timer);
    t.timer = setTimeout(() => {
      t.fired = true;
      buzz(18);
      setSheet(true);
    }, LONG_PRESS_MS);
  };
  const onTouchMove = (e) => {
    const t = touch.current;
    if (!canAct || t.fired) return;
    const ddx = e.touches[0].clientX - t.x;
    const ddy = e.touches[0].clientY - t.y;
    if (!t.lock && (Math.abs(ddx) > 10 || Math.abs(ddy) > 10)) {
      clearTimeout(t.timer);
      t.lock = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y';
    }
    if (t.lock === 'x' && canReply) {
      const next = Math.max(0, Math.min(ddx, 84));
      if (next >= SWIPE_TRIGGER && dx < SWIPE_TRIGGER) buzz(8);
      setDx(next);
    }
  };
  const onTouchEnd = () => {
    const t = touch.current;
    clearTimeout(t.timer);
    if (t.lock === 'x' && dx >= SWIPE_TRIGGER && canReply) onReply(m);
    setDx(0);
    if (!t.lock && !t.fired) {
      const now = Date.now();
      if (now - t.lastTap < 300) {
        t.lastTap = 0;
        heart();
      } else {
        t.lastTap = now;
      }
    }
  };
  const onTouchCancel = () => {
    clearTimeout(touch.current.timer);
    setDx(0);
  };

  const openSheet = (e) => {
    if (!canAct) return;
    e.preventDefault();
    setSheet(true);
  };

  return (
    <div data-mid={m.id} className={cx('group relative flex', mine ? 'justify-end' : 'justify-start', isGroup && !mine && 'gap-1.5')}>
      {isGroup && !mine && (
        <span className="mt-auto w-7 shrink-0">{showSender && <Avatar name={sender?.displayName} src={sender?.avatarUrl} size={28} />}</span>
      )}
      <span
        className="pointer-events-none absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface-solid/90 text-accent shadow-sm"
        style={{ opacity: Math.min(dx / SWIPE_TRIGGER, 1), transform: `translateY(-50%) scale(${0.6 + Math.min(dx / SWIPE_TRIGGER, 1) * 0.4})` }}
        aria-hidden
      >
        <CornerUpLeft className="h-4 w-4" />
      </span>
      <div
        className={cx('flex min-w-0 max-w-[84%] flex-col sm:max-w-[65%]', mine ? 'items-end' : 'items-start')}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? 'none' : 'transform .2s ease-out' }}
      >
        <div className="relative flex items-center gap-1">
          {/* Desktop hover actions (phones use long-press / swipe / double-tap) */}
          {canAct && (
            <button
              onClick={() => setSheet(true)}
              className={cx('hidden rounded-full px-2 py-1 text-xs text-muted hover:bg-surface-solid/80 hover:text-accent md:group-hover:block', mine ? 'order-first' : 'order-last')}
              aria-label="Message actions"
            >
              •••
            </button>
          )}
          <div
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
            onContextMenu={openSheet}
            onDoubleClick={heart}
            className={cx(
              'touch-pan-y select-none rounded-3xl px-3.5 pb-1.5 pt-2 shadow-sm [-webkit-touch-callout:none] md:select-text',
              mine ? 'bubble-me rounded-br-lg' : 'bubble-them rounded-bl-lg',
              m.deleted && 'italic opacity-60',
              flash && 'ring-4 ring-accent/60',
            )}
          >
            {showSender && (
              <span className="mb-0.5 block text-xs font-semibold" style={{ color: nameColor(m.senderId) }}>
                {sender?.displayName ?? 'Someone'}
              </span>
            )}
            {replyTo && (
              <button
                type="button"
                onClick={() => onJump(replyTo.id)}
                className={cx('mb-1.5 block w-full rounded-xl border-l-4 px-2.5 py-1 text-left text-xs', mine ? 'border-current/60 bg-black/15' : 'border-accent bg-black/5')}
              >
                <span className="block font-semibold">{replyName}</span>
                <span className="line-clamp-2 opacity-80">{previewOf(replyTo)}</span>
              </button>
            )}
            {m.deleted ? 'Message removed' : null}
            <MediaGrid items={m.attachments} onOpen={onOpen} className={m.body ? 'mb-1.5' : ''} />
            {m.body && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body}</p>}
            <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] opacity-70">
              {m.expiresAt && <Timer className="h-3 w-3" aria-label="Disappearing message" />}
              {m.editedAt && !m.deleted && <span>edited</span>}
              <span>{fmtTime(m.createdAt)}</span>
              {mine && seen && <CheckCheck className="h-3.5 w-3.5" aria-label="Seen" />}
            </span>
          </div>
        </div>
        {grouped.length > 0 && (
          <div className={cx('mt-0.5 flex gap-1.5 px-1.5', mine ? 'justify-end' : 'justify-start')}>
            {grouped.map(([emoji, n]) => (
              <button
                key={emoji}
                onClick={() => writable && onReact(m, emoji)}
                className="flex items-center gap-0.5 text-xl leading-none transition active:scale-125"
                aria-label={`${emoji} reaction${n > 1 ? `, ${n}` : ''}`}
              >
                <span>{emoji}</span>
                {n > 1 && <span className="text-xs font-medium text-ink-soft">{n}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {sheet && (
        <MessageSheet
          m={m}
          mine={mine}
          meId={meId}
          accent={accent}
          writable={writable}
          onClose={() => setSheet(false)}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onReact={onReact}
          onCopy={onCopy}
        />
      )}
    </div>
  );
}

export function ChatView() {
  const { rid, me, partner, writable, space, typing, typingNames, isGroup, membersById, others } = useSpace();
  const socket = useSocket();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { open, lightbox } = useLightbox();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [flashId, setFlashId] = useState(null);
  const scroller = useRef(null);
  const input = useRef(null);
  const lastTyping = useRef(0);
  const stickToBottom = useRef(true);

  const query = useInfiniteQuery({
    queryKey: qk.messages(rid),
    queryFn: ({ pageParam }) => api.get(relUrl(rid, `/messages${pageParam ? `?before=${pageParam}` : ''}`)),
    initialPageParam: null,
    getNextPageParam: (last) => (last.hasMore ? last.messages[0]?.id : undefined),
  });
  const [now, setNow] = useState(() => Date.now());
  const allMessages = useMemo(() => flattenMessages(query.data, rid), [query.data, rid]);
  // Disappearing messages vanish on screen the moment they expire (the server erases them shortly after).
  const messages = useMemo(() => allMessages.filter((m) => !m.expiresAt || new Date(m.expiresAt).getTime() > now), [allMessages, now]);
  useEffect(() => {
    const current = Date.now();
    const times = allMessages.filter((m) => m.expiresAt).map((m) => new Date(m.expiresAt).getTime()).filter((t) => t > current);
    if (!times.length) return undefined;
    const id = setTimeout(() => setNow(Date.now()), Math.min(Math.min(...times) - current + 250, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [allMessages, now]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const last = messages[messages.length - 1];
  const nameOf = (m) => (m.senderId === me.userId ? 'You' : (membersById.get(m.senderId)?.displayName ?? 'Someone'));

  // Mark as read when the newest message is from my partner.
  useEffect(() => {
    if (!last || last.senderId === me.userId || document.hidden) return;
    api.post(relUrl(rid, '/read'), { messageId: last.id }).then(() => queryClient.invalidateQueries({ queryKey: qk.relationships })).catch(() => {});
  }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  const onScroll = () => {
    const el = scroller.current;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = fromBottom < 120;
    setShowJump(fromBottom > 400);
    if (el.scrollTop < 80 && query.hasNextPage && !query.isFetchingNextPage) {
      const prevHeight = el.scrollHeight;
      query.fetchNextPage().then(() => requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - prevHeight)));
    }
  };

  const scrollToBottom = () => {
    const el = scroller.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const jumpTo = useCallback((id) => {
    const el = scroller.current?.querySelector(`[data-mid="${id}"]`);
    if (!el) return toast('That message is further back. Scroll up to load it.');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(id);
    setTimeout(() => setFlashId(null), 1600);
  }, [toast]);

  const emitTyping = (isTyping) => {
    if (!socket) return;
    if (isTyping && Date.now() - lastTyping.current < 2500) return;
    lastTyping.current = isTyping ? Date.now() : 0;
    socket.emit(EVENTS.TYPING, { relationshipId: rid, isTyping });
  };

  const send = async (body, attachmentIds = []) => {
    const { message } = await api.post(relUrl(rid, '/messages'), {
      clientId: newClientId(),
      body,
      attachmentIds,
      replyToId: replyTo?.id ?? null,
    });
    stickToBottom.current = true;
    queryClient.setQueryData(qk.messages(rid), (old) => upsertMessage(old, message));
    setReplyTo(null);
  };

  const submit = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      if (editing) {
        const { message } = await api.patch(relUrl(rid, `/messages/${editing.id}`), { body });
        queryClient.setQueryData(qk.messages(rid), (old) => upsertMessage(old, message));
        setEditing(null);
      } else {
        await send(body);
      }
      setText('');
      emitTyping(false);
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const attach = async (files, durationMs) => {
    if (!files.length) return;
    setSending(true);
    try {
      const uploaded = [];
      for (const f of files) uploaded.push(await uploadToSpace(rid, f, { purpose: 'message', durationMs }));
      await send(text.trim(), uploaded.map((a) => a.id));
      setText('');
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const react = async (m, emoji) => {
    try {
      const { message } = await api.post(relUrl(rid, `/messages/${m.id}/reactions`), { emoji });
      queryClient.setQueryData(qk.messages(rid), (old) => upsertMessage(old, message));
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  };

  const remove = async (m) => {
    if (!confirm('Remove this message for both of you?')) return;
    try {
      const { message } = await api.delete(relUrl(rid, `/messages/${m.id}`));
      queryClient.setQueryData(qk.messages(rid), (old) => upsertMessage(old, message));
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  };

  const copy = async (m) => {
    try {
      await navigator.clipboard.writeText(m.body);
      toast('Copied');
    } catch {
      toast('Could not copy', { tone: 'error' });
    }
  };

  const startReply = (m) => {
    setEditing(null);
    setReplyTo(m);
    input.current?.focus();
  };
  const startEdit = (m) => {
    setReplyTo(null);
    setEditing(m);
    setText(m.body);
    input.current?.focus();
  };

  // 1:1: when my partner last read. Group: the time EVERYONE else has read up to (the oldest of their markers).
  const readTimes = (isGroup ? others : [partner]).map((p) => (p?.lastReadAt ? new Date(p.lastReadAt).getTime() : null));
  const partnerReadAt = readTimes.length && readTimes.every((t) => t !== null) ? new Date(Math.min(...readTimes)) : null;
  const showReceipts = space.preferences?.showReadReceipts !== false;
  const lastMineSeenId = showReceipts
    ? [...messages].reverse().find((m) => m.senderId === me.userId && partnerReadAt && new Date(m.createdAt) <= partnerReadAt)?.id
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1" style={chatBackgroundStyle(space.preferences, space.wallpaperUrl)}>
        <ThemeFx type={themeFx(space.preferences)} />
        {space.preferences?.disappearAfterSec > 0 && (
          <p className="pointer-events-none absolute left-1/2 top-2 z-[2] flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface-solid/85 px-3 py-1 text-[11px] font-medium text-ink-soft shadow-sm backdrop-blur">
            <Timer className="h-3 w-3 text-accent" /> Messages disappear after {describeSeconds(space.preferences.disappearAfterSec)}
          </p>
        )}
        <div
          ref={scroller}
          onScroll={onScroll}
          className="scrollbar-thin relative z-[1] h-full space-y-1.5 overflow-y-auto overscroll-contain px-2.5 py-4 pt-9 sm:space-y-2 sm:px-8 sm:py-5 sm:pt-10"
        >
          {query.isLoading && <Spinner />}
          {query.isFetchingNextPage && <p className="text-center text-xs text-muted">Loading earlier messages…</p>}
          {!query.isLoading && messages.length === 0 && (
            <EmptyState title="The first words">Every great love story starts with a hello.</EmptyState>
          )}
          {messages.map((m, i) => {
            const showDay = i === 0 || new Date(messages[i - 1].createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const replied = m.replyToId ? byId.get(m.replyToId) : null;
            return (
              <Fragment key={m.id}>
                {showDay && (
                  <p className="sticky top-0 z-[1] mx-auto my-2 w-fit rounded-full bg-surface-solid/85 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-muted shadow-sm backdrop-blur">
                    {dayLabel(m.createdAt)}
                  </p>
                )}
                {m.type === 'system' ? (
                  <p data-mid={m.id} className="mx-auto my-1 w-fit max-w-[90%] rounded-full bg-surface-solid/80 px-3 py-1 text-center text-xs text-ink-soft shadow-sm backdrop-blur">
                    {m.body}
                  </p>
                ) : (
                <Bubble
                  m={m}
                  mine={m.senderId === me.userId}
                  meId={me.userId}
                  accent={space.preferences?.accent}
                  seen={m.id === lastMineSeenId}
                  replyTo={replied}
                  replyName={replied ? nameOf(replied) : ''}
                  isGroup={isGroup}
                  sender={membersById.get(m.senderId)}
                  showSender={isGroup && m.senderId !== me.userId && (i === 0 || showDay || messages[i - 1].senderId !== m.senderId || messages[i - 1].type === 'system')}
                  flash={flashId === m.id}
                  onReply={startReply}
                  onEdit={startEdit}
                  onDelete={remove}
                  onReact={react}
                  onOpen={open}
                  onJump={jumpTo}
                  onCopy={copy}
                  writable={writable}
                />
                )}
              </Fragment>
            );
          })}
          {typing && (
            <div className="flex flex-col items-start gap-0.5">
              {isGroup && <span className="ml-9 rounded-full bg-surface-solid/80 px-2 text-[11px] text-ink-soft">{typingNames.join(', ')}</span>}
              <span className={cx('bubble-them rounded-3xl rounded-bl-lg px-4 py-3 opacity-80 shadow-sm', isGroup && 'ml-9')}>
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:240ms]" />
                </span>
              </span>
            </div>
          )}
        </div>
        {showJump && (
          <button
            onClick={scrollToBottom}
            className="animate-pop-in absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-solid text-accent shadow-soft ring-1 ring-line"
            aria-label="Jump to latest message"
          >
            <ArrowDown className="h-5 w-5" />
          </button>
        )}
      </div>

      {writable ? (
        <form onSubmit={submit} className="border-t border-line bg-surface-solid/90 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3">
          {(replyTo || editing) && (
            <div className="mb-2 flex items-center gap-2 rounded-2xl border-l-4 border-accent bg-accent-soft px-3 py-2 text-sm text-accent">
              {editing ? <Pencil className="h-4 w-4 shrink-0" /> : <CornerUpLeft className="h-4 w-4 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold">{editing ? 'Editing message' : `Replying to ${nameOf(replyTo)}`}</span>
                <span className="line-clamp-1 text-ink-soft">{editing ? editing.body : previewOf(replyTo)}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setReplyTo(null);
                  if (editing) setText('');
                  setEditing(null);
                }}
                aria-label="Cancel"
                className="rounded-full p-1 hover:bg-surface-solid/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-1.5">
            <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-soft hover:bg-accent-soft hover:text-accent" aria-label="Attach photos, videos or files">
              <Paperclip className="h-5 w-5" />
              <input
                type="file"
                multiple
                hidden
                accept="image/*,video/*,audio/*,application/pdf"
                onChange={(e) => {
                  attach([...e.target.files]);
                  e.target.value = '';
                }}
              />
            </label>
            <textarea
              ref={input}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                emitTyping(true);
              }}
              onKeyDown={(e) => {
                // Phones: Enter is a newline (the send button sends). Desktop: Enter sends, Shift+Enter is a newline.
                if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) submit(e);
              }}
              onBlur={() => emitTyping(false)}
              rows={1}
              maxLength={4000}
              placeholder="Write something sweet…"
              className="max-h-40 min-h-10 flex-1 resize-none rounded-3xl border border-line bg-surface-solid px-4 py-2.5 text-[16px] outline-none focus:border-accent"
            />
            {text.trim() ? (
              <Button type="submit" size="icon" loading={sending} aria-label="Send">
                {!sending && <Send className="h-4 w-4" />}
              </Button>
            ) : (
              <VoiceRecorder disabled={sending} onRecorded={(file, durationMs) => attach([file], durationMs)} />
            )}
          </div>
        </form>
      ) : (
        <p className="border-t border-line bg-surface-solid/90 p-4 text-center text-sm text-muted">This conversation is read-only.</p>
      )}
      {lightbox}
    </div>
  );
}
