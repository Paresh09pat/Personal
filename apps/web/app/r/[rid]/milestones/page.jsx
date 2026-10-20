'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarHeart, Plus, Trash2 } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { useSection } from '@/lib/hooks';
import { qk } from '@/lib/queryKeys';
import { daysBetween, fmtDate, nextOccurrence, toDateInput } from '@/lib/format';
import { useSpace } from '@/components/SpaceShell';
import { Button, Card, EmptyState, ErrorText, Field, Input, Modal, Spinner, Textarea } from '@/components/ui';

export default function MilestonesPage() {
  const { rid, writable, space } = useSpace();
  const queryClient = useQueryClient();
  const { data, isLoading } = useSection(rid, 'milestones');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', date: toDateInput(new Date()), recurring: true, emoji: '💗', note: '' });
  const [error, setError] = useState(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.section(rid, 'milestones') });

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post(relUrl(rid, '/milestones'), form);
      setOpen(false);
      setForm({ title: '', date: toDateInput(new Date()), recurring: true, emoji: '💗', note: '' });
      refresh();
    } catch (err) {
      setError(err);
    }
  };
  const remove = async (m) => {
    if (!confirm(`Delete "${m.title}"?`)) return;
    await api.delete(relUrl(rid, `/milestones/${m.id}`));
    refresh();
  };

  if (isLoading) return <Spinner />;
  const anniversary = space.anniversaryDate;
  const together = anniversary ? daysBetween(anniversary, new Date()) : null;
  const nextAnniv = anniversary ? nextOccurrence(anniversary) : null;
  const items = (data?.items ?? [])
    .map((m) => ({ ...m, next: m.recurring ? nextOccurrence(m.date) : new Date(m.date) }))
    .sort((a, b) => a.next - b.next);

  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden bg-gradient-to-br from-accent to-gold text-white">
        {anniversary ? (
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-sm uppercase tracking-widest opacity-80">Together for</p>
              <p className="font-display text-7xl leading-none">{together}</p>
              <p className="opacity-90">days, since {fmtDate(anniversary)}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-sm uppercase tracking-widest opacity-80">Next anniversary</p>
              <p className="font-display text-5xl leading-none">{daysBetween(new Date(), nextAnniv) === 0 ? 'Today! 🎉' : `${daysBetween(new Date(), nextAnniv)} days`}</p>
              <p className="opacity-90">{fmtDate(nextAnniv)}</p>
            </div>
          </div>
        ) : (
          <p className="font-display text-2xl">Set your anniversary in Settings to start counting your days together 💗</p>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="font-display text-3xl">Dates to remember</h2>
        {writable && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add date
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarHeart} title="No dates yet">Birthdays, first kiss, the day you met — never miss one.</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((m) => {
            const days = daysBetween(new Date(), m.next);
            return (
              <Card key={m.id} className="flex items-center gap-4 p-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-3xl">{m.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-2xl">{m.title}</p>
                  <p className="text-sm text-muted">
                    {fmtDate(m.date)} {m.recurring && '· every year'}
                  </p>
                  {m.note && <p className="truncate text-sm text-ink-soft">{m.note}</p>}
                </div>
                <div className="text-right">
                  <p className="font-display text-3xl text-accent">{days < 0 ? '—' : days === 0 ? 'Today' : days}</p>
                  {days > 0 && <p className="text-xs text-muted">days</p>}
                </div>
                {writable && (
                  <button onClick={() => remove(m)} className="rounded-full p-2 text-muted hover:text-danger" aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="A date to remember">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-[5rem_1fr] gap-3">
            <Field label="Emoji">
              <Input maxLength={8} value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} className="text-center text-2xl" />
            </Field>
            <Field label="What">
              <Input required maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="The day we met" />
            </Field>
          </div>
          <Field label="Date">
            <Input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} /> Repeats every year
          </label>
          <Field label="Note">
            <Textarea maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="min-h-20" />
          </Field>
          <ErrorText error={error} />
          <Button type="submit">Save date</Button>
        </form>
      </Modal>
    </div>
  );
}
