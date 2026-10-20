'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, RefreshCw, Share2, XCircle } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { fmtDate } from '@/lib/format';
import { Button, ErrorText, Field, Input } from './ui';

/**
 * Owner-only invitation management for a pending space. The server returns the raw link exactly
 * once (it only stores a hash), so a new link must be generated if this one is lost.
 */
export function InvitePanel({ rid, initialLink = null }) {
  const queryClient = useQueryClient();
  const [link, setLink] = useState(initialLink);
  const [email, setEmail] = useState('');
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
      const { invitation } = await api.post(relUrl(rid, '/invitations'), email ? { inviteeEmail: email } : {});
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

  const share = () => navigator.share?.({ title: 'Our Little World', text: 'Come join our little world 💗', url: link.url });

  return (
    <div className="space-y-4">
      {link ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            Send this private link to your person. It works <strong>once</strong> and expires {fmtDate(link.expiresAt)}.
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
              An invitation is active until {fmtDate(current.expiresAt)}. For your privacy the link is shown only once —
              generate a new one if you lost it (the old one stops working).
            </p>
          )}
          <Field label="Their email (optional)" hint="If set, only an account with this email can accept.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="love@example.com" />
          </Field>
          <Button onClick={generate} loading={busy}>
            <RefreshCw className="h-4 w-4" /> {current ? 'Generate a new link' : 'Create invitation link'}
          </Button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}
