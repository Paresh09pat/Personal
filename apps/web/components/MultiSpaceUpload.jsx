'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ImagePlus, ShieldCheck } from 'lucide-react';
import { uploadToSpace } from '@/lib/upload';
import { qk } from '@/lib/queryKeys';
import { Avatar, Button, ErrorText, Modal, cx } from './ui';
import { spaceName } from '@/lib/space';

/**
 * "Add photos" to the galleries of several of YOUR spaces at once.
 * Isolation is preserved: each selected space gets its own separate upload (own authorization
 * check, own private file, own attachment id). Nothing is shared between spaces.
 */
export function MultiSpaceUpload({ open, onClose, spaces }) {
  const queryClient = useQueryClient();
  const active = spaces.filter((s) => s.status === 'active');
  const [selected, setSelected] = useState(() => new Set());
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const close = () => {
    setSelected(new Set());
    setFiles([]);
    setProgress(null);
    setError(null);
    onClose();
  };

  const upload = async () => {
    setError(null);
    const jobs = [...selected].flatMap((rid) => files.map((file) => ({ rid, file })));
    setProgress({ done: 0, total: jobs.length });
    const failed = [];
    for (const { rid, file } of jobs) {
      try {
        await uploadToSpace(rid, file, { purpose: 'gallery' });
      } catch (err) {
        failed.push(`${file.name}: ${err.message}`);
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    for (const rid of selected) queryClient.invalidateQueries({ queryKey: qk.section(rid, 'gallery') });
    if (failed.length) setError(new Error(`Some uploads failed — ${failed.slice(0, 3).join('; ')}`));
    else close();
  };

  const busy = progress && progress.done < progress.total;

  return (
    <Modal open={open} onClose={busy ? undefined : close} title="Add photos to galleries">
      <div className="space-y-5">
        <p className="flex items-start gap-2 rounded-2xl bg-accent-soft px-4 py-3 text-sm text-accent">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Each space you pick gets its own private copy. A photo added to one space is never visible in another.
        </p>

        <div>
          <p className="mb-2 text-sm font-medium text-ink-soft">1. Choose photos or videos</p>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-5 hover:border-accent">
            <ImagePlus className="h-6 w-6 text-accent" />
            <span className="text-sm">{files.length ? `${files.length} file(s) selected` : 'Tap to pick from your device'}</span>
            <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => setFiles([...e.target.files])} />
          </label>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ink-soft">2. Add them to</p>
          {active.length === 0 ? (
            <p className="text-sm text-muted">You have no active spaces yet.</p>
          ) : (
            <div className="space-y-2">
              {active.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  aria-pressed={selected.has(s.id)}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition',
                    selected.has(s.id) ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent',
                  )}
                >
                  <Avatar name={spaceName(s)} src={s.partner?.avatarUrl} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{spaceName(s)}</span>
                    <span className="block truncate text-xs text-muted">{s.title || 'Gallery'}</span>
                  </span>
                  <span className={cx('flex h-6 w-6 items-center justify-center rounded-full border', selected.has(s.id) ? 'border-accent bg-accent text-accent-ink' : 'border-line')}>
                    {selected.has(s.id) && <Check className="h-3.5 w-3.5" />}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {progress && (
          <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
            <div className="h-full bg-accent transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        )}
        <ErrorText error={error} />
        <Button onClick={upload} loading={busy} disabled={!files.length || !selected.size} className="w-full justify-center">
          Upload to {selected.size || ''} space{selected.size === 1 ? '' : 's'}
        </Button>
      </div>
    </Modal>
  );
}
