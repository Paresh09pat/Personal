'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, Mail, MailOpen, PenLine, Trash2 } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { useSection } from '@/lib/hooks';
import { qk } from '@/lib/queryKeys';
import { fmtDate, toLocalDateTimeInput } from '@/lib/format';
import { useSpace } from '@/components/SpaceShell';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Modal, Spinner, Textarea, cx } from '@/components/ui';

const SUGGESTIONS = ['Open when you miss me', 'Open when you can’t sleep', 'Open when you’re sad', 'Open on our anniversary', 'Open when you need a laugh'];

function Envelope({ letter, mine, onOpen }) {
  return (
    <button
      onClick={() => onOpen(letter)}
      className={cx(
        'glass group relative flex aspect-[4/3] w-full flex-col justify-between overflow-hidden rounded-3xl p-5 text-left transition hover:-translate-y-0.5',
        letter.locked && !mine && 'opacity-80',
      )}
    >
      <span className="absolute inset-x-0 top-0 h-1/2 origin-top bg-gradient-to-b from-accent-soft to-transparent [clip-path:polygon(0_0,100%_0,50%_100%)]" />
      <span className="relative flex items-center justify-between">
        {letter.locked ? <Lock className="h-5 w-5 text-accent" /> : letter.openedAt ? <MailOpen className="h-5 w-5 text-accent" /> : <Mail className="h-5 w-5 text-accent" />}
        {mine ? <Badge tone="muted">From you</Badge> : !letter.openedAt && !letter.locked ? <Badge>New</Badge> : null}
      </span>
      <span className="relative">
        <span className="block font-display text-2xl leading-tight">{letter.title}</span>
        <span className="text-xs text-muted">
          {letter.locked ? `Unlocks ${fmtDate(letter.unlockAt)}` : letter.openedAt ? `Opened ${fmtDate(letter.openedAt)}` : 'Ready to open'}
        </span>
      </span>
    </button>
  );
}

export default function LettersPage() {
  const { rid, writable, me, partner } = useSpace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useSection(rid, 'letters');
  const [writing, setWriting] = useState(false);
  const [reading, setReading] = useState(null);
  const [form, setForm] = useState({ title: SUGGESTIONS[0], body: '', unlockAt: '' });
  const [error, setError] = useState(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.section(rid, 'letters') });

  const send = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post(relUrl(rid, '/letters'), {
        title: form.title,
        body: form.body,
        unlockAt: form.unlockAt ? new Date(form.unlockAt).toISOString() : null,
      });
      setWriting(false);
      setForm({ title: SUGGESTIONS[0], body: '', unlockAt: '' });
      refresh();
      toast('Your letter is sealed and delivered 💌');
    } catch (err) {
      setError(err);
    }
  };

  const openLetter = async (letter) => {
    if (letter.authorId === me.userId) return setReading(letter);
    if (letter.locked) return toast(`This one is sealed until ${fmtDate(letter.unlockAt)} 💗`);
    const { item } = await api.post(relUrl(rid, `/letters/${letter.id}/open`));
    setReading(item);
    refresh();
  };

  const remove = async (letter) => {
    if (!confirm('Delete this letter?')) return;
    await api.delete(relUrl(rid, `/letters/${letter.id}`));
    setReading(null);
    refresh();
  };

  if (isLoading) return <Spinner />;
  const items = data?.items ?? [];
  const received = items.filter((l) => l.recipientId === me.userId);
  const written = items.filter((l) => l.authorId === me.userId);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <p className="text-ink-soft">Sealed letters for exactly the right moment.</p>
        {writable && partner && (
          <Button onClick={() => setWriting(true)}>
            <PenLine className="h-4 w-4" /> Write a letter
          </Button>
        )}
      </div>
      {items.length === 0 && (
        <Card>
          <EmptyState icon={Mail} title="No letters yet">Write an “open when…” letter — it can stay sealed until a date you choose.</EmptyState>
        </Card>
      )}
      {received.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl">For you</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {received.map((l) => (
              <Envelope key={l.id} letter={l} onOpen={openLetter} />
            ))}
          </div>
        </section>
      )}
      {written.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl">Written by you</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {written.map((l) => (
              <Envelope key={l.id} letter={l} mine onOpen={openLetter} />
            ))}
          </div>
        </section>
      )}

      <Modal open={writing} onClose={() => setWriting(false)} title="Write a letter">
        <form onSubmit={send} className="space-y-4">
          <Field label="Title">
            <Input required list="letter-suggestions" maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <datalist id="letter-suggestions">
              {SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Your letter">
            <Textarea required className="min-h-48 font-display text-xl" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          <Field label="Keep it sealed until (optional)" hint="Your partner sees the title, but the words stay locked until then.">
            <Input type="datetime-local" min={toLocalDateTimeInput(new Date())} value={form.unlockAt} onChange={(e) => setForm({ ...form, unlockAt: e.target.value })} />
          </Field>
          <ErrorText error={error} />
          <Button type="submit">Seal & send</Button>
        </form>
      </Modal>

      <Modal open={Boolean(reading)} onClose={() => setReading(null)} title={reading?.title ?? ''}>
        {reading && (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap rounded-3xl bg-[#fff8f0] p-6 font-display text-2xl leading-relaxed text-[#4a1d2c] shadow-inner">{reading.body}</p>
            <p className="text-sm text-muted">
              {reading.authorId === me.userId ? `To ${partner?.displayName}` : `From ${partner?.displayName}`} · {fmtDate(reading.createdAt)}
              {reading.unlockAt && ` · sealed until ${fmtDate(reading.unlockAt)}`}
            </p>
            {writable && reading.authorId === me.userId && !reading.openedAt && (
              <Button variant="ghost" onClick={() => remove(reading)}>
                <Trash2 className="h-4 w-4" /> Delete letter
              </Button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
