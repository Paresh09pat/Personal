'use client';

import { useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { uploadToSpace } from '@/lib/upload';
import { MediaThumb } from './Media';
import { cx } from './ui';

/** Uploads into the current space with a given purpose and reports the resulting attachment list. */
export function MediaPicker({ rid, purpose, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pick = async (files) => {
    setBusy(true);
    setError(null);
    try {
      const added = [];
      for (const f of files) added.push(await uploadToSpace(rid, f, { purpose }));
      onChange([...value, ...added]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((a) => (
          <div key={a.id} className="relative h-20 w-20">
            <MediaThumb a={a} className="pointer-events-none h-full w-full rounded-xl" />
            <button type="button" onClick={() => onChange(value.filter((x) => x.id !== a.id))} className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-1 text-bg" aria-label="Remove">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <label className={cx('flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line text-xs text-muted hover:border-accent hover:text-accent', busy && 'pointer-events-none opacity-60')}>
          <ImagePlus className="mb-1 h-5 w-5" />
          {busy ? '…' : 'Add'}
          <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => pick([...e.target.files])} />
        </label>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
