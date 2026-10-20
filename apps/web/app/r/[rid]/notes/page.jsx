'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NotebookPen, Pin, Plus, Trash2 } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { useSection } from '@/lib/hooks';
import { qk } from '@/lib/queryKeys';
import { fmtRelative } from '@/lib/format';
import { useSpace } from '@/components/SpaceShell';
import { Button, Card, EmptyState, ErrorText, Modal, Spinner, Textarea, cx } from '@/components/ui';

const COLORS = {
  blush: 'bg-[#fde4ec] text-[#5a1830]',
  rose: 'bg-[#f8bbd0] text-[#4a1027]',
  cream: 'bg-[#fff4dc] text-[#4d3a12]',
  lavender: 'bg-[#ece6fa] text-[#33245c]',
  gold: 'bg-[#f6e3a8] text-[#4a3a08]',
};

export default function NotesPage() {
  const { rid, writable, me, partner } = useSpace();
  const queryClient = useQueryClient();
  const { data, isLoading } = useSection(rid, 'notes');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ body: '', color: 'blush', pinned: false });
  const [error, setError] = useState(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.section(rid, 'notes') });

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post(relUrl(rid, '/notes'), form);
      setForm({ body: '', color: 'blush', pinned: false });
      setOpen(false);
      refresh();
    } catch (err) {
      setError(err);
    }
  };

  const togglePin = async (n) => {
    await api.patch(relUrl(rid, `/notes/${n.id}`), { pinned: !n.pinned });
    refresh();
  };
  const remove = async (n) => {
    await api.delete(relUrl(rid, `/notes/${n.id}`));
    refresh();
  };

  if (isLoading) return <Spinner />;
  const items = data?.items ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-ink-soft">Little notes left on the fridge of your hearts.</p>
        {writable && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Leave a note
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={NotebookPen} title="No notes yet">Leave a little love note for {partner?.displayName ?? 'your person'} to find.</EmptyState>
        </Card>
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
          {items.map((n, i) => (
            <div key={n.id} className={cx('mb-4 break-inside-avoid rounded-3xl p-5 shadow-soft', COLORS[n.color] ?? COLORS.blush)} style={{ rotate: `${((i % 5) - 2) * 0.6}deg` }}>
              <p className="whitespace-pre-wrap font-display text-2xl leading-snug">{n.body}</p>
              <div className="mt-4 flex items-center justify-between text-xs opacity-70">
                <span>
                  {n.authorId === me.userId ? 'You' : partner?.displayName} · {fmtRelative(n.createdAt)}
                </span>
                {writable && n.authorId === me.userId && (
                  <span className="flex gap-1">
                    <button onClick={() => togglePin(n)} aria-label={n.pinned ? 'Unpin' : 'Pin'} className={cx('rounded-full p-1.5 hover:bg-black/10', n.pinned && 'opacity-100')}>
                      <Pin className={cx('h-3.5 w-3.5', n.pinned && 'fill-current')} />
                    </button>
                    <button onClick={() => remove(n)} aria-label="Delete" className="rounded-full p-1.5 hover:bg-black/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="A little love note">
        <form onSubmit={save} className="space-y-4">
          <Textarea required maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="I love the way you…" />
          <div className="flex gap-2">
            {Object.keys(COLORS).map((c) => (
              <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} className={cx('h-9 w-9 rounded-full ring-offset-2 ring-offset-surface-solid', COLORS[c], form.color === c && 'ring-2 ring-accent')} aria-label={c} />
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} /> Pin to the top
          </label>
          <ErrorText error={error} />
          <Button type="submit">Leave note</Button>
        </form>
      </Modal>
    </div>
  );
}
