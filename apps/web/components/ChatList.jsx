'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, LogOut, MailWarning, MessageCirclePlus, MoreVertical, Search, UserRound, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthConfig, useMe, useRelationships } from '@/lib/hooks';
import { isGroupSpace, listTime, spaceAvatar, spaceName, spaceSubtitle } from '@/lib/space';
import { Avatar, Spinner, cx } from './ui';
import { useToast } from './Toast';
import { CreateSpaceModal } from './CreateSpaceModal';
import { MultiSpaceUpload } from './MultiSpaceUpload';

function ChatRow({ space, active }) {
  const dim = space.status === 'archived' || space.status === 'ended';
  return (
    <Link
      href={`/r/${space.id}`}
      className={cx(
        'flex items-center gap-3 px-4 py-3 transition',
        active ? 'bg-accent-soft' : 'hover:bg-accent-soft/60',
        dim && 'opacity-70',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <span className="relative shrink-0">
        <Avatar name={spaceName(space)} src={spaceAvatar(space)} size={50} />
        {isGroupSpace(space) && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-ink ring-2 ring-surface-solid">
            <Users className="h-3 w-3" />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1 border-b border-line pb-3 pt-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[15px] font-semibold">{spaceName(space)}</p>
          <span className={cx('shrink-0 text-xs', space.unreadCount > 0 ? 'font-semibold text-accent' : 'text-muted')}>
            {listTime(space.lastMessage?.createdAt ?? space.lastActivityAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className={cx('truncate text-sm', space.status === 'pending' ? 'italic text-muted' : 'text-ink-soft')}>
            {spaceSubtitle(space)}
          </p>
          {space.unreadCount > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-ink">
              {space.unreadCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function Menu({ isAdmin, onAddPhotos, canAddPhotos }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    queryClient.clear();
    router.replace('/login');
  };

  const item = 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent-soft';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="rounded-full p-2 text-ink-soft hover:bg-accent-soft hover:text-accent" aria-label="Menu" aria-expanded={open}>
        <MoreVertical className="h-5 w-5" />
      </button>
      {open && (
        <div className="glass animate-pop-in absolute right-0 z-40 mt-1 w-56 rounded-2xl bg-surface-solid p-1.5">
          {isAdmin && canAddPhotos && (
            <button className={item} onClick={() => { setOpen(false); onAddPhotos(); }}>
              <ImagePlus className="h-4 w-4 text-accent" /> Add photos to galleries
            </button>
          )}
          <Link href="/account" className={item} onClick={() => setOpen(false)}>
            <UserRound className="h-4 w-4 text-accent" /> Account
          </Link>
          <button className={item} onClick={logout}>
            <LogOut className="h-4 w-4 text-accent" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * WhatsApp-style chat list. Shows ONLY the spaces the server returned for this user — each row opens
 * that one private space. Admin (site owner) can start new chats and add photos to several galleries.
 */
export function ChatList({ createOpen, onCreateOpenChange }) {
  const { rid } = useParams();
  const { data: me } = useMe();
  const { data: spaces, isLoading } = useRelationships();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const { data: authConfig } = useAuthConfig();
  const isAdmin = Boolean(me?.user?.isAdmin);
  const canCreate = isAdmin || authConfig?.spaceCreation === 'everyone';
  const user = me?.user;
  // Your own photo: the one you set in the chat that is open, else any chat where you set one.
  const myAvatar = ((spaces ?? []).find((s) => s.id === rid) ?? (spaces ?? []).find((s) => s.me?.avatarUrl))?.me?.avatarUrl;

  const q = query.trim().toLowerCase();
  const visible = (spaces ?? []).filter((s) => !q || spaceName(s).toLowerCase().includes(q) || s.title?.toLowerCase().includes(q));
  const live = visible.filter((s) => s.status === 'active' || s.status === 'pending');
  const past = visible.filter((s) => s.status === 'archived' || s.status === 'ended');
  const needsVerify = user && !user.emailVerified && me.requireVerification;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-4 pb-2 pt-4">
        <Link href="/account" aria-label="Your account">
          <Avatar name={user?.displayName} src={myAvatar} size={40} />
        </Link>
        <h1 className="flex-1 font-display text-3xl font-semibold">Chats</h1>
        {canCreate && (
          <button onClick={() => onCreateOpenChange(true)} className="rounded-full p-2 text-accent hover:bg-accent-soft" aria-label="New chat or group" title="New chat or group">
            <MessageCirclePlus className="h-5 w-5" />
          </button>
        )}
        <Menu isAdmin={isAdmin} canAddPhotos={(spaces ?? []).some((s) => s.status === 'active')} onAddPhotos={() => setUploadOpen(true)} />
      </header>

      {needsVerify && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-2xl bg-gold/15 px-3 py-2 text-xs">
          <MailWarning className="h-4 w-4 shrink-0 text-gold" />
          <span className="flex-1">Confirm your email to start chats.</span>
          <button className="font-semibold text-gold" onClick={() => api.post('/api/auth/resend-verification').then(() => toast('Email sent 💌'))}>
            Resend
          </button>
        </div>
      )}

      <div className="px-4 pb-2">
        <label className="flex items-center gap-2 rounded-full bg-accent-soft/70 px-4 py-2">
          <Search className="h-4 w-4 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="w-full bg-transparent text-sm outline-none placeholder:text-muted" aria-label="Search chats" />
        </label>
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto" aria-label="Your chats">
        {isLoading ? (
          <Spinner />
        ) : (spaces ?? []).length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-ink-soft">
            {canCreate ? (
              <>
                <p className="mb-4">No chats yet. Start a chat or a group and send your private invite link 💌</p>
                <button onClick={() => onCreateOpenChange(true)} className="rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink">
                  Start a chat
                </button>
              </>
            ) : (
              <p>Open the private invite link you received to start chatting 💌</p>
            )}
          </div>
        ) : (
          <>
            {live.map((s) => (
              <ChatRow key={s.id} space={s} active={s.id === rid} />
            ))}
            {past.length > 0 && <p className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted">Archived & past</p>}
            {past.map((s) => (
              <ChatRow key={s.id} space={s} active={s.id === rid} />
            ))}
            {visible.length === 0 && <p className="px-6 py-8 text-center text-sm text-muted">No chats match “{query}”.</p>}
          </>
        )}
      </nav>

      {canCreate && <CreateSpaceModal open={createOpen} onClose={() => onCreateOpenChange(false)} myName={user?.displayName} />}
      <MultiSpaceUpload open={uploadOpen} onClose={() => setUploadOpen(false)} spaces={spaces ?? []} />
    </div>
  );
}
