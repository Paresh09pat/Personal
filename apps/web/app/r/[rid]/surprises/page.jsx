'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, EyeOff, Gift, Heart, Plus, Send, Trash2 } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { useSection } from '@/lib/hooks';
import { qk } from '@/lib/queryKeys';
import { fmtDate, toLocalDateTimeInput } from '@/lib/format';
import { useSpace } from '@/components/SpaceShell';
import { MediaGrid, useLightbox } from '@/components/Media';
import { MediaPicker } from '@/components/MediaPicker';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Modal, Spinner, Textarea, cx } from '@/components/ui';

function Hearts() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: 14 }).map((_, i) => (
        <Heart
          key={i}
          className="animate-float-heart absolute bottom-0 fill-accent text-accent"
          style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 0.18}s`, width: 14 + (i % 4) * 6 }}
        />
      ))}
    </div>
  );
}

export default function SurprisesPage() {
  const { rid, writable, partner } = useSpace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { open, lightbox } = useLightbox();
  const { data, isLoading } = useSection(rid, 'surprises');
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState(null);
  const [form, setForm] = useState({ title: '', message: '', media: [], when: 'draft', revealAt: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.section(rid, 'surprises') });

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(relUrl(rid, '/surprises'), {
        title: form.title,
        message: form.message,
        mediaIds: form.media.map((m) => m.id),
        status: form.when === 'now' ? 'revealed' : form.when === 'later' ? 'scheduled' : 'draft',
        revealAt: form.when === 'later' && form.revealAt ? new Date(form.revealAt).toISOString() : null,
      });
      setCreating(false);
      setForm({ title: '', message: '', media: [], when: 'draft', revealAt: '' });
      refresh();
      toast(form.when === 'now' ? 'Surprise delivered 🎁' : 'Your secret is safe with us 🤫');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const publish = async (s) => {
    await api.post(relUrl(rid, `/surprises/${s.id}/publish`), {});
    refresh();
    toast('Surprise revealed 🎁');
  };
  const remove = async (s) => {
    if (!confirm('Delete this surprise?')) return;
    await api.delete(relUrl(rid, `/surprises/${s.id}`));
    refresh();
  };
  const unwrap = async (s) => {
    setRevealed(s);
    if (!s.seenAt) api.post(relUrl(rid, `/surprises/${s.id}/seen`)).then(refresh).catch(() => {});
  };

  if (isLoading) return <Spinner />;
  const items = data?.items ?? [];
  const forMe = items.filter((s) => !s.mine);
  const mine = items.filter((s) => s.mine);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-soft">Plan in secret. Reveal at the perfect moment.</p>
        {writable && partner && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Plan a surprise
          </Button>
        )}
      </div>

      {data?.upcomingForMe > 0 && (
        <Card className="flex items-center gap-4 bg-accent-soft">
          <Gift className="h-8 w-8 text-accent" />
          <p className="font-display text-2xl text-accent">
            {data.upcomingForMe} surprise{data.upcomingForMe > 1 ? 's are' : ' is'} on the way… 🤫
          </p>
        </Card>
      )}

      <section>
        <h2 className="mb-3 font-display text-2xl">For you</h2>
        {forMe.length === 0 ? (
          <p className="text-sm text-muted">Nothing revealed yet — but who knows what’s coming?</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {forMe.map((s) => (
              <button key={s.id} onClick={() => unwrap(s)} className="glass relative flex aspect-square flex-col items-center justify-center gap-3 rounded-3xl p-4 text-center transition hover:-translate-y-0.5">
                {!s.seenAt && <Badge className="absolute right-3 top-3">New</Badge>}
                <Gift className={cx('h-12 w-12 text-accent', !s.seenAt && 'animate-bounce')} />
                <span className="font-display text-xl leading-tight">{s.seenAt ? s.title : 'Tap to unwrap'}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-display text-2xl">Planned by you</h2>
        <p className="mb-3 flex items-center gap-1.5 text-sm text-muted">
          <EyeOff className="h-3.5 w-3.5" /> Drafts and scheduled surprises are invisible to {partner?.displayName ?? 'your partner'} until revealed.
        </p>
        {mine.length === 0 ? (
          <Card>
            <EmptyState icon={Gift} title="No secrets yet">Plan a surprise — a message, photos, a date idea — and reveal it whenever you like.</EmptyState>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {mine.map((s) => (
              <Card key={s.id} className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-2xl">{s.title}</h3>
                  <Badge tone={s.status === 'revealed' ? 'soft' : s.status === 'scheduled' ? 'gold' : 'muted'}>{s.status}</Badge>
                </div>
                {s.message && <p className="line-clamp-3 text-sm text-ink-soft">{s.message}</p>}
                <MediaGrid items={s.media.slice(0, 4)} onOpen={open} className="max-w-xs" />
                {s.status === 'scheduled' && (
                  <p className="flex items-center gap-1.5 text-sm text-gold">
                    <CalendarClock className="h-4 w-4" /> Reveals {fmtDate(s.revealAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                )}
                {writable && (
                  <div className="flex gap-2">
                    {s.status !== 'revealed' && (
                      <Button size="sm" onClick={() => publish(s)}>
                        <Send className="h-4 w-4" /> Reveal now
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => remove(s)}>
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <Modal open={creating} onClose={() => setCreating(false)} title="Plan a surprise">
        <form onSubmit={create} className="space-y-4">
          <Field label="Title">
            <Input required maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Pack a bag for Saturday…" />
          </Field>
          <Field label="Message">
            <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </Field>
          <Field label="Photos & videos" hint="Stay private to you until the surprise is revealed.">
            <MediaPicker rid={rid} purpose="surprise" value={form.media} onChange={(media) => setForm({ ...form, media })} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink-soft">When should they see it?</legend>
            {[
              ['draft', 'Keep it as a secret draft'],
              ['later', 'Reveal automatically at a set time'],
              ['now', 'Reveal right now'],
            ].map(([v, label]) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <input type="radio" name="when" checked={form.when === v} onChange={() => setForm({ ...form, when: v })} /> {label}
              </label>
            ))}
            {form.when === 'later' && (
              <Input type="datetime-local" required min={toLocalDateTimeInput(new Date())} value={form.revealAt} onChange={(e) => setForm({ ...form, revealAt: e.target.value })} />
            )}
          </fieldset>
          <ErrorText error={error} />
          <Button type="submit" loading={busy}>
            Save surprise
          </Button>
        </form>
      </Modal>

      <Modal open={Boolean(revealed)} onClose={() => setRevealed(null)} title={revealed?.title ?? ''}>
        {revealed && (
          <div className="relative space-y-4">
            <Hearts />
            {revealed.message && <p className="whitespace-pre-wrap font-display text-2xl leading-relaxed">{revealed.message}</p>}
            <MediaGrid items={revealed.media} onOpen={open} />
            <p className="text-sm text-muted">With love, {partner?.displayName}</p>
          </div>
        )}
      </Modal>
      {lightbox}
    </div>
  );
}
