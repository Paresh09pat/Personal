'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { useSection } from '@/lib/hooks';
import { qk } from '@/lib/queryKeys';
import { fmtDate, toDateInput } from '@/lib/format';
import { useSpace } from '@/components/SpaceShell';
import { MediaGrid, useLightbox } from '@/components/Media';
import { MediaPicker } from '@/components/MediaPicker';
import { Button, Card, EmptyState, ErrorText, Field, Input, Modal, Spinner, Textarea } from '@/components/ui';

const blank = () => ({ title: '', body: '', date: toDateInput(new Date()), location: '', media: [] });

export default function MemoriesPage() {
  const { rid, writable, me } = useSpace();
  const queryClient = useQueryClient();
  const { data, isLoading } = useSection(rid, 'memories');
  const { open, lightbox } = useLightbox();
  const [editing, setEditing] = useState(null); // null | 'new' | memory
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.section(rid, 'memories') });

  const startEdit = (m) => {
    setEditing(m ?? 'new');
    setError(null);
    setForm(m ? { title: m.title, body: m.body, date: toDateInput(m.date), location: m.location, media: m.media } : blank());
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { title: form.title, body: form.body, date: form.date, location: form.location, mediaIds: form.media.map((m) => m.id) };
    try {
      if (editing === 'new') await api.post(relUrl(rid, '/memories'), body);
      else await api.patch(relUrl(rid, `/memories/${editing.id}`), body);
      setEditing(null);
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m) => {
    if (!confirm(`Delete "${m.title}"?`)) return;
    await api.delete(relUrl(rid, `/memories/${m.id}`));
    refresh();
  };

  if (isLoading) return <Spinner />;
  const items = data?.items ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-ink-soft">The story of you two, one moment at a time.</p>
        {writable && (
          <Button onClick={() => startEdit(null)}>
            <Plus className="h-4 w-4" /> Add memory
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={Sparkles} title="Your timeline starts here">The first date, the first trip, the first “I love you”.</EmptyState>
        </Card>
      ) : (
        <ol className="relative space-y-8 border-l-2 border-accent/30 pl-6 sm:pl-10">
          {items.map((m) => (
            <li key={m.id} className="relative">
              <span className="absolute -left-[33px] top-6 h-4 w-4 rounded-full border-4 border-bg bg-accent sm:-left-[49px]" />
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-accent">{fmtDate(m.date)}</p>
                    <h3 className="font-display text-3xl">{m.title}</h3>
                    {m.location && (
                      <p className="flex items-center gap-1 text-sm text-muted">
                        <MapPin className="h-3.5 w-3.5" /> {m.location}
                      </p>
                    )}
                  </div>
                  {writable && m.authorId === me.userId && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => startEdit(m)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(m)} aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
                {m.body && <p className="mt-3 whitespace-pre-wrap text-ink-soft">{m.body}</p>}
                <MediaGrid items={m.media} onOpen={open} className="mt-4 max-w-md" />
              </Card>
            </li>
          ))}
        </ol>
      )}

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'A new memory' : 'Edit memory'}>
        <form onSubmit={save} className="space-y-4">
          <Field label="Title">
            <Input required maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Our first date" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date">
              <Input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Where">
              <Input maxLength={140} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </Field>
          </div>
          <Field label="The story">
            <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          <Field label="Photos & videos">
            <MediaPicker rid={rid} purpose="memory" value={form.media} onChange={(media) => setForm({ ...form, media })} />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" loading={busy}>
            Save memory
          </Button>
        </form>
      </Modal>
      {lightbox}
    </div>
  );
}
