'use client';

import { useState } from 'react';
import { Button, ErrorText, Field, Input, Modal } from './ui';

/** Explicit confirmation for destructive actions: password + a typed phrase, checked again by the server. */
export function ConfirmWithPassword({ open, onClose, title, description, phrase, actionLabel, onConfirm }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ password, confirm });
      setPassword('');
      setConfirm('');
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2 text-ink-soft">{description}</div>
        <Field label="Your password">
          <Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={`Type ${phrase} to confirm`}>
          <Input required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </Field>
        <ErrorText error={error} />
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={confirm !== phrase}>
            {actionLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
