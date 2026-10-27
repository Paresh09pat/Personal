'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, RefreshCw, Share2, XCircle } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { fmtDate } from '@/lib/format';
import { Button, ErrorText, Field, Input } from './ui';

/**
 * Invitation management. The server returns the raw link exactly once (it only stores a hash), so a
 * new link must be generated if this one is lost; making a new link also stops the old one.
 *  - 1:1 (owner of a pending space): a single-use link, optionally locked to one email address.
 *  - group (any admin): one shareable link that works for several people until it expires.
 */
export function InvitePanel({ rid, kind = 'direct', initialLink = null }) {
  const group = kind === 'group';
  const queryClient = useQueryClient();
  const [link, setLink] = useState(initialLink);
  const [email, setEmail] = useState('');
  const [limit, setLimit] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data: current } = useQuery({
    queryKey: qk.section(rid, 'invitation'),
    queryFn: async () => (await api.get(relUrl(rid, '/invitations/current'))).invitation,
  });

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = group ? (limit ? { maxUses: Number(limit) } : {}) : email ? { inviteeEmail: email } : {};
      const { invitation } = await api.post(relUrl(rid, '/invitations'), body);
      setLink(invitation);
      queryClient.invalidateQueries({ queryKey: qk.section(rid, 'invitation') });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    await api.delete(relUrl(rid, '/invitations/current'));
    setLink(null);
    queryClient.invalidateQueries({ queryKey: qk.section(rid, 'invitation') });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = () =>
    navigator.share?.({
      title: 'Our Little World',
      text: group ? 'Join our group on Our Little World 💗' : 'Come join our little world 💗',
      url: link.url,
    });

  return (
    <div className="space-y-4">
      {link ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            {group ? (
              <>
                Share this private link with the people you want in the group. It works for{' '}
                {link.maxUses ? <strong>up to {link.maxUses} people</strong> : 'several people'} until it expires{' '}
                {fmtDate(link.expiresAt)}.
              </>
            ) : (
              <>
                Send this private link to your person. It works <strong>once</strong> and expires {fmtDate(link.expiresAt)}.
              </>
            )}
          </p>
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface-solid/70 p-2 pl-4">
            <Link2 className="h-4 w-4 shrink-0 text-accent" />
            <code className="min-w-0 flex-1 truncate text-sm">{link.url}</code>
            <Button size="sm" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {typeof navigator !== 'undefined' && navigator.share && (
              <Button size="sm" variant="soft" onClick={share}>
                <Share2 className="h-4 w-4" /> Share
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={revoke}>
              <XCircle className="h-4 w-4" /> Revoke link
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {current && (
            <p className="rounded-2xl bg-accent-soft px-4 py-3 text-sm text-accent">
              A link is active until {fmtDate(current.expiresAt)}
              {group ? ` and has been used ${current.usesCount} time${current.usesCount === 1 ? '' : 's'}` : ''}. For your
              privacy it is shown only once. Generate a new one if you lost it (the old one stops working).
            </p>
          )}
          {group ? (
            <Field label="Limit (optional)" hint="Stop the link after this many people have joined. Leave empty for no limit.">
              <Input type="number" min={1} max={30} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="No limit" />
            </Field>
          ) : (
            <Field label="Their email (optional)" hint="If set, only an account with this email can accept.">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="love@example.com" />
            </Field>
          )}
          <Button onClick={generate} loading={busy}>
            <RefreshCw className="h-4 w-4" /> {current ? 'Generate a new link' : 'Create invitation link'}
          </Button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}
