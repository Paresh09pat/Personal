'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Download, HeartCrack, Trash2, Undo2 } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { clearSpaceCache } from '@/lib/spaceCache';
import { toDateInput } from '@/lib/format';
import { uploadToSpace } from '@/lib/upload';
import { useSpace } from '@/components/SpaceShell';
import { useToast } from '@/components/Toast';
import { InvitePanel } from '@/components/InvitePanel';
import { ConfirmWithPassword } from '@/components/ConfirmWithPassword';
import { Avatar, Button, Card, ErrorText, Field, Input, cx } from '@/components/ui';

const ACCENTS = { rose: '#c2185b', wine: '#8e2443', lavender: '#7c5cbf', gold: '#b8860b', ocean: '#1e6f8f' };

function Section({ title, children, className }) {
  return (
    <Card className={cx('space-y-4', className)}>
      <h2 className="font-display text-3xl">{title}</h2>
      {children}
    </Card>
  );
}

export default function SettingsPage() {
  const { rid, space, me } = useSpace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const editable = ['pending', 'active'].includes(space.status);
  const [shared, setShared] = useState({
    title: space.title,
    anniversaryDate: toDateInput(space.anniversaryDate),
    accent: space.preferences?.accent ?? 'rose',
    showTyping: space.preferences?.showTyping !== false,
    showReadReceipts: space.preferences?.showReadReceipts !== false,
  });
  const [mine, setMine] = useState({ displayName: me.ownDisplayName ?? '', ...me.notificationPrefs });
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // 'end' | 'delete' | 'deletePending'
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.relDetail(rid) });
    queryClient.invalidateQueries({ queryKey: qk.relationships });
  };
  const run = async (fn, okMessage) => {
    setError(null);
    try {
      await fn();
      refresh();
      if (okMessage) toast(okMessage);
    } catch (err) {
      setError(err);
    }
  };

  const saveShared = (e) => {
    e.preventDefault();
    run(
      () =>
        api.patch(relUrl(rid), {
          title: shared.title,
          anniversaryDate: shared.anniversaryDate || null,
          preferences: { accent: shared.accent, showTyping: shared.showTyping, showReadReceipts: shared.showReadReceipts },
        }),
      'Saved 💗',
    );
  };
  const saveMine = (e) => {
    e.preventDefault();
    const { displayName, ...prefs } = mine;
    run(() => api.patch(relUrl(rid, '/me'), { displayName, notificationPrefs: prefs }), 'Saved 💗');
  };
  const uploadImage = (purpose) => async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await run(async () => {
      const a = await uploadToSpace(rid, file, { purpose });
      if (purpose === 'avatar') await api.patch(relUrl(rid, '/me'), { avatarAttachmentId: a.id });
      else await api.patch(relUrl(rid), { coverAttachmentId: a.id });
    }, 'Photo updated');
  };

  const exportSpace = async () => {
    const res = await fetch(relUrl(rid, '/export'), { credentials: 'same-origin' });
    if (!res.ok) return toast('Export failed — try again later', { tone: 'error' });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `our-little-world-${rid}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const leave = () => {
    clearSpaceCache(queryClient, rid);
    queryClient.invalidateQueries({ queryKey: qk.relationships });
    router.replace('/dashboard');
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="This space">
        <form onSubmit={saveShared} className="space-y-4">
          <div className="relative h-28 overflow-hidden rounded-2xl bg-gradient-to-br from-accent to-gold">
            {space.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- private media
              <img src={space.coverUrl} alt="" className="h-full w-full object-cover" />
            )}
            {editable && (
              <label className="absolute bottom-2 right-2 cursor-pointer rounded-full bg-black/50 px-3 py-1 text-xs text-white">
                Change cover
                <input type="file" accept="image/*" hidden onChange={uploadImage('cover')} />
              </label>
            )}
          </div>
          <Field label="Name of this space">
            <Input disabled={!editable} maxLength={140} value={shared.title} onChange={(e) => setShared({ ...shared, title: e.target.value })} />
          </Field>
          <Field label="Anniversary" hint="Used for your days-together counter.">
            <Input disabled={!editable} type="date" value={shared.anniversaryDate} onChange={(e) => setShared({ ...shared, anniversaryDate: e.target.value })} />
          </Field>
          <Field label="Colour">
            <div className="flex gap-2">
              {Object.entries(ACCENTS).map(([k, color]) => (
                <button key={k} type="button" disabled={!editable} onClick={() => setShared({ ...shared, accent: k })} style={{ background: color }} className={cx('h-9 w-9 rounded-full ring-offset-2 ring-offset-surface-solid', shared.accent === k && 'ring-2 ring-ink')} aria-label={k} />
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!editable} checked={shared.showTyping} onChange={(e) => setShared({ ...shared, showTyping: e.target.checked })} /> Show typing indicator
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!editable} checked={shared.showReadReceipts} onChange={(e) => setShared({ ...shared, showReadReceipts: e.target.checked })} /> Show read receipts
          </label>
          {editable && <Button type="submit">Save</Button>}
        </form>
      </Section>

      <Section title="You, in this space">
        <form onSubmit={saveMine} className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={me.displayName} src={me.avatarUrl} size={64} />
            {space.status !== 'ended' && (
              <label className="cursor-pointer text-sm font-medium text-accent hover:underline">
                Change photo
                <input type="file" accept="image/*" hidden onChange={uploadImage('avatar')} />
              </label>
            )}
          </div>
          <Field label="Your name here" hint="Only shown inside this space.">
            <Input maxLength={60} value={mine.displayName} onChange={(e) => setMine({ ...mine, displayName: e.target.value })} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink-soft">Notifications</legend>
            {[
              ['muted', 'Mute this space'],
              ['messages', 'New messages'],
              ['activity', 'Notes, letters, memories & surprises'],
              ['calls', 'Incoming calls'],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={Boolean(mine[k])} onChange={(e) => setMine({ ...mine, [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </fieldset>
          {space.status !== 'ended' && <Button type="submit">Save</Button>}
        </form>
      </Section>

      {space.status === 'pending' && me.role === 'owner' && (
        <Section title="Invitation" className="lg:col-span-2">
          <InvitePanel rid={rid} />
        </Section>
      )}

      <Section title="Your data & this space" className="lg:col-span-2">
        <ErrorText error={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          {space.status !== 'pending' && (
            <Button variant="outline" onClick={exportSpace}>
              <Download className="h-4 w-4" /> Export this space (JSON)
            </Button>
          )}
          {space.status === 'active' && (
            <Button variant="outline" onClick={() => run(() => api.post(relUrl(rid, '/archive')), 'Space archived')}>
              <Archive className="h-4 w-4" /> Archive (read-only)
            </Button>
          )}
          {space.status === 'archived' && (
            <Button variant="outline" onClick={() => run(() => api.post(relUrl(rid, '/unarchive')), 'Welcome back 💗')}>
              <ArchiveRestore className="h-4 w-4" /> Unarchive
            </Button>
          )}
          {['active', 'archived'].includes(space.status) && (
            <Button variant="outline" className="!text-danger" onClick={() => setDialog('end')}>
              <HeartCrack className="h-4 w-4" /> End this relationship space
            </Button>
          )}
          {space.status === 'ended' && !space.deletionRequestedByMe && (
            <Button variant="danger" onClick={() => setDialog('delete')}>
              <Trash2 className="h-4 w-4" /> Request permanent deletion
            </Button>
          )}
          {space.status === 'ended' && space.deletionRequestedByMe && (
            <Button variant="outline" onClick={() => run(() => api.delete(relUrl(rid, '/deletion-request')), 'Deletion request withdrawn')}>
              <Undo2 className="h-4 w-4" /> Withdraw my deletion request
            </Button>
          )}
          {space.status === 'pending' && me.role === 'owner' && (
            <Button variant="danger" onClick={() => setDialog('deletePending')}>
              <Trash2 className="h-4 w-4" /> Delete this space
            </Button>
          )}
        </div>
        {space.status === 'ended' && (
          <p className="text-sm text-muted">
            Permanent deletion happens only when both of you request it.{' '}
            {space.deletionRequestedByPartner ? 'Your partner has already requested it.' : ''}
          </p>
        )}
      </Section>

      <ConfirmWithPassword
        open={dialog === 'end'}
        onClose={() => setDialog(null)}
        title="End this space?"
        phrase="END"
        actionLabel="End space"
        description={
          <>
            <p>The space becomes read-only for both of you. Nothing is deleted: you can both still read and export everything.</p>
            <p>This cannot be undone, but you can always start a new space together later.</p>
          </>
        }
        onConfirm={async (body) => {
          await api.post(relUrl(rid, '/end'), body);
          refresh();
        }}
      />
      <ConfirmWithPassword
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title="Permanently delete?"
        phrase="DELETE"
        actionLabel="Request deletion"
        description={<p>When both of you have requested it, every message, photo, letter and memory in this space is erased forever. Export first if you want a copy.</p>}
        onConfirm={async (body) => {
          const res = await api.post(relUrl(rid, '/deletion-request'), body);
          if (res.purged) leave();
          else refresh();
        }}
      />
      <ConfirmWithPassword
        open={dialog === 'deletePending'}
        onClose={() => setDialog(null)}
        title="Delete this waiting space?"
        phrase="DELETE"
        actionLabel="Delete"
        description={<p>Nobody has joined yet, so this simply removes the space and its invitation.</p>}
        onConfirm={async (body) => {
          await api.delete(relUrl(rid), body);
          leave();
        }}
      />
    </div>
  );
}
