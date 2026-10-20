'use client';

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, CornerUpLeft, Paperclip, Pencil, Send, SmilePlus, Trash2, X } from 'lucide-react';
import { EVENTS, REACTIONS } from '@olw/shared';
import { api, relUrl } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { dayLabel, fmtTime } from '@/lib/format';
import { flattenMessages, upsertMessage } from '@/lib/spaceCache';
import { uploadToSpace } from '@/lib/upload';
import { useSocket } from './SocketProvider';
import { useSpace } from './SpaceShell';
import { useToast } from './Toast';
import { MediaGrid, useLightbox } from './Media';
import { VoiceRecorder } from './VoiceRecorder';
import { Button, EmptyState, Spinner, cx } from './ui';

const newClientId = () => crypto.randomUUID();

function Bubble({ m, mine, seen, replyTo, onReply, onEdit, onDelete, onReact, onOpen, writable }) {
  const [menu, setMenu] = useState(false);
  const grouped = Object.entries(
    m.reactions.reduce((acc, r) => ({ ...acc, [r.emoji]: (acc[r.emoji] ?? 0) + 1 }), {}),
  );
  return (
    <div className={cx('group flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cx('relative max-w-[82%] sm:max-w-[65%]', mine ? 'items-end' : 'items-start', 'flex flex-col')}>
        <div
          className={cx(
            'rounded-3xl px-4 py-2.5 shadow-sm',
            mine ? 'rounded-br-lg bg-accent text-accent-ink' : 'rounded-bl-lg bg-bubble-them text-ink',
            m.deleted && 'italic opacity-60',
          )}
        >
          {replyTo && (
            <p className={cx('mb-1.5 line-clamp-2 border-l-2 pl-2 text-xs', mine ? 'border-accent-ink/50 opacity-80' : 'border-accent text-ink-soft')}>
              {replyTo.deleted ? 'Message removed' : replyTo.body || '📎 Attachment'}
            </p>
          )}
          {m.deleted ? 'Message removed' : null}
          <MediaGrid items={m.attachments} onOpen={onOpen} className={m.body ? 'mb-2' : ''} />
          {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        </div>
        <div className={cx('mt-1 flex items-center gap-1.5 px-2 text-[11px] text-muted', mine && 'flex-row-reverse')}>
          <span>{fmtTime(m.createdAt)}</span>
          {m.editedAt && !m.deleted && <span>· edited</span>}
          {mine && seen && <CheckCheck className="h-3.5 w-3.5 text-accent" aria-label="Seen" />}
        </div>
        {grouped.length > 0 && (
          <div className={cx('-mt-1 flex gap-1', mine ? 'pr-2' : 'pl-2')}>
            {grouped.map(([emoji, n]) => (
              <button key={emoji} onClick={() => writable && onReact(m, emoji)} className="rounded-full bg-surface-solid px-1.5 text-sm shadow-sm ring-1 ring-line">
                {emoji}
                {n > 1 && <span className="ml-0.5 text-xs">{n}</span>}
              </button>
            ))}
          </div>
        )}
        {writable && !m.deleted && (
          <div className={cx('absolute top-1 hidden gap-0.5 group-hover:flex', mine ? '-left-24' : '-right-24', menu && 'flex')}>
            <button onClick={() => setMenu((v) => !v)} className="rounded-full p-1.5 text-muted hover:bg-accent-soft hover:text-accent" aria-label="React">
              <SmilePlus className="h-4 w-4" />
            </button>
            <button onClick={() => onReply(m)} className="rounded-full p-1.5 text-muted hover:bg-accent-soft hover:text-accent" aria-label="Reply">
              <CornerUpLeft className="h-4 w-4" />
            </button>
            {mine && m.body && (
              <button onClick={() => onEdit(m)} className="rounded-full p-1.5 text-muted hover:bg-accent-soft hover:text-accent" aria-label="Edit">
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {mine && (
              <button onClick={() => onDelete(m)} className="rounded-full p-1.5 text-muted hover:bg-accent-soft hover:text-danger" aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        {menu && (
          <div className={cx('glass animate-pop-in absolute -top-11 z-10 flex gap-1 rounded-full bg-surface-solid px-2 py-1', mine ? 'right-0' : 'left-0')}>
            {REACTIONS.map((e) => (
              <button
                key={e}
                className="rounded-full p-1 text-lg transition hover:scale-125"
                onClick={() => {
                  onReact(m, e);
                  setMenu(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatView() {
  const { rid, me, partner, writable, space, typing } = useSpace();
  const socket = useSocket();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { open, lightbox } = useLightbox();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef(null);
  const lastTyping = useRef(0);
  const stickToBottom = useRef(true);

  const query = useInfiniteQuery({
    queryKey: qk.messages(rid),
    queryFn: ({ pageParam }) => api.get(relUrl(rid, `/messages${pageParam ? `?before=${pageParam}` : ''}`)),
    initialPageParam: null,
    getNextPageParam: (last) => (last.hasMore ? last.messages[0]?.id : undefined),
  });
  const messages = useMemo(() => flattenMessages(query.data, rid), [query.data, rid]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const last = messages[messages.length - 1];

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
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 80 && query.hasNextPage && !query.isFetchingNextPage) {
      const prevHeight = el.scrollHeight;
      query.fetchNextPage().then(() => requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - prevHeight)));
    }
  };

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
    const { message } = await api.post(relUrl(rid, `/messages/${m.id}/reactions`), { emoji });
    queryClient.setQueryData(qk.messages(rid), (old) => upsertMessage(old, message));
  };

  const remove = async (m) => {
    if (!confirm('Remove this message for both of you?')) return;
    const { message } = await api.delete(relUrl(rid, `/messages/${m.id}`));
    queryClient.setQueryData(qk.messages(rid), (old) => upsertMessage(old, message));
  };

  const partnerReadAt = partner?.lastReadAt ? new Date(partner.lastReadAt) : null;
  const showReceipts = space.preferences?.showReadReceipts !== false;
  const lastMineSeenId = showReceipts
    ? [...messages].reverse().find((m) => m.senderId === me.userId && partnerReadAt && new Date(m.createdAt) <= partnerReadAt)?.id
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto bg-bg-deep/40 px-3 py-5 sm:px-8"
        style={{ backgroundImage: 'radial-gradient(color-mix(in oklab, var(--accent) 7%, transparent) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
      >
        {query.isLoading && <Spinner />}
        {query.isFetchingNextPage && <p className="text-center text-xs text-muted">Loading earlier messages…</p>}
        {!query.isLoading && messages.length === 0 && (
          <EmptyState title="The first words">Every great love story starts with a hello.</EmptyState>
        )}
        {messages.map((m, i) => {
          const showDay = i === 0 || new Date(messages[i - 1].createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          return (
            <Fragment key={m.id}>
              {showDay && (
                <p className="py-3 text-center text-xs font-medium uppercase tracking-wider text-muted">{dayLabel(m.createdAt)}</p>
              )}
              <Bubble
                m={m}
                mine={m.senderId === me.userId}
                seen={m.id === lastMineSeenId}
                replyTo={m.replyToId ? byId.get(m.replyToId) : null}
                onReply={setReplyTo}
                onEdit={(msg) => {
                  setEditing(msg);
                  setText(msg.body);
                }}
                onDelete={remove}
                onReact={react}
                onOpen={open}
                writable={writable}
              />
            </Fragment>
          );
        })}
        {typing && (
          <div className="flex">
            <span className="rounded-3xl rounded-bl-lg bg-bubble-them px-4 py-3 text-muted">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:240ms]" />
              </span>
            </span>
          </div>
        )}
      </div>

      {writable ? (
        <form onSubmit={submit} className="border-t border-line bg-surface-solid/80 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3">
          {(replyTo || editing) && (
            <div className="mb-2 flex items-center gap-2 rounded-2xl bg-accent-soft px-3 py-2 text-sm text-accent">
              {editing ? <Pencil className="h-4 w-4" /> : <CornerUpLeft className="h-4 w-4" />}
              <span className="line-clamp-1 flex-1">{editing ? 'Editing message' : replyTo.body || 'Attachment'}</span>
              <button
                type="button"
                onClick={() => {
                  setReplyTo(null);
                  if (editing) setText('');
                  setEditing(null);
                }}
                aria-label="Cancel"
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
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                emitTyping(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) submit(e);
              }}
              onBlur={() => emitTyping(false)}
              rows={1}
              maxLength={4000}
              placeholder="Write something sweet…"
              className="max-h-40 min-h-10 flex-1 resize-none rounded-3xl border border-line bg-surface-solid px-4 py-2.5 outline-none focus:border-accent"
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
        <p className="border-t border-line p-4 text-center text-sm text-muted">This conversation is read-only.</p>
      )}
      {lightbox}
    </div>
  );
}
