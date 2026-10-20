'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { Button, ErrorText, Field, Input, Modal } from './ui';
import { InvitePanel } from './InvitePanel';

/** Step 1: create a pending space. Step 2: generate the private, single-use invite link. */
export function CreateSpaceFlow({ onDone, myName = '' }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: '', myDisplayName: myName });
  const [space, setSpace] = useState(null);
  const [link, setLink] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { relationship } = await api.post('/api/relationships', form);
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
          <Heart className="h-4 w-4 fill-accent text-accent" /> Chat created. Send this link — it opens only this chat.
        </p>
        <InvitePanel rid={space.id} initialLink={link} />
        <Button variant="outline" onClick={() => onDone?.(space)} className="w-full justify-center">
          Done
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={create} className="space-y-4">
      <Field label="Who is this chat with?" hint="Shown in your chat list. After they join, their own name appears.">
        <Input required value={form.title} maxLength={140} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Her name" />
      </Field>
      <Field label="Your name in this chat" hint="What they will see you as, only inside this chat.">
        <Input value={form.myDisplayName} maxLength={60} onChange={(e) => setForm({ ...form, myDisplayName: e.target.value })} />
      </Field>
      <ErrorText error={error} />
      <Button type="submit" loading={busy} className="w-full justify-center">
        Create chat & get invite link
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
