'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Heart, UserRound, Users } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { Button, ErrorText, Field, Input, Modal } from './ui';
import { InvitePanel } from './InvitePanel';

function KindChoice({ onPick }) {
  const card = 'flex w-full items-center gap-4 rounded-2xl border border-line p-4 text-left transition hover:border-accent hover:bg-accent-soft/60';
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">What kind of chat do you want to start?</p>
      <button className={card} onClick={() => onPick('direct')}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <UserRound className="h-6 w-6" />
        </span>
        <span>
          <span className="block font-semibold">One-to-one</span>
          <span className="block text-sm text-ink-soft">A private space for two people: chat, calls, letters, surprises.</span>
        </span>
      </button>
      <button className={card} onClick={() => onPick('group')}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Users className="h-6 w-6" />
        </span>
        <span>
          <span className="block font-semibold">Group</span>
          <span className="block text-sm text-ink-soft">Family, friends or a trip crew: up to 30 people, one shared link to join.</span>
        </span>
      </button>
    </div>
  );
}

/** Pick 1:1 or group → create it → hand out the private invite link. */
export function CreateSpaceFlow({ onDone, myName = '' }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState(null);
  const [form, setForm] = useState({ title: '', myDisplayName: myName });
  const [space, setSpace] = useState(null);
  const [link, setLink] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const group = kind === 'group';

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { relationship } = await api.post('/api/relationships', { ...form, kind });
      const { invitation } = await api.post(relUrl(relationship.id, '/invitations'), {});
      setSpace(relationship);
      setLink(invitation);
      queryClient.invalidateQueries({ queryKey: qk.relationships });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (space) {
    return (
      <div className="space-y-5">
        <p className="flex items-center gap-2 text-ink-soft">
          <Heart className="h-4 w-4 fill-accent text-accent" />
          {group ? 'Group created. Share this link with the people you want in it.' : 'Chat created. Send this link — it opens only this chat.'}
        </p>
        <InvitePanel rid={space.id} kind={space.kind} initialLink={link} />
        <Button variant="outline" onClick={() => onDone?.(space)} className="w-full justify-center">
          Done
        </Button>
      </div>
    );
  }

  if (!kind) return <KindChoice onPick={setKind} />;

  return (
    <form onSubmit={create} className="space-y-4">
      <button type="button" onClick={() => setKind(null)} className="-mt-1 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-accent">
        <ChevronLeft className="h-4 w-4" /> Back
      </button>
      <Field
        label={group ? 'Group name' : 'Who is this chat with?'}
        hint={group ? 'Everyone in the group sees this name. You can change it later.' : 'Shown in your chat list. After they join, their own name appears.'}
      >
        <Input required value={form.title} maxLength={140} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={group ? 'Weekend trip crew' : 'Her name'} />
      </Field>
      <Field label={group ? 'Your name in this group' : 'Your name in this chat'} hint="What others will see you as, only inside this chat.">
        <Input value={form.myDisplayName} maxLength={60} onChange={(e) => setForm({ ...form, myDisplayName: e.target.value })} />
      </Field>
      <ErrorText error={error} />
      <Button type="submit" loading={busy} className="w-full justify-center">
        {group ? 'Create group & get invite link' : 'Create chat & get invite link'}
      </Button>
    </form>
  );
}

export function CreateSpaceModal({ open, onClose, myName }) {
  return (
    <Modal open={open} onClose={onClose} title="New chat">
      {open && <CreateSpaceFlow onDone={onClose} myName={myName} />}
    </Modal>
  );
}
