'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Send, Square, Trash2 } from 'lucide-react';
import { fmtDuration } from '@/lib/format';
import { Button } from './ui';

const pickMime = () =>
  ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => globalThis.MediaRecorder?.isTypeSupported?.(m)) ?? '';

/** Records a voice note with MediaRecorder and hands back a File. */
export function VoiceRecorder({ onRecorded, disabled }) {
  const [state, setState] = useState('idle'); // idle | recording | review
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const started = useRef(0);

  useEffect(() => {
    if (state !== 'recording') return undefined;
    const t = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => () => clip && URL.revokeObjectURL(clip.url), [clip]);

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = (rec.mimeType || 'audio/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const blob = new Blob(chunks.current, { type });
      const file = new File([blob], `voice-note.${ext}`, { type });
      setClip({ file, url: URL.createObjectURL(blob), durationMs: Date.now() - started.current });
      setState('review');
    };
    recorder.current = rec;
    started.current = Date.now();
    setElapsed(0);
    rec.start();
    setState('recording');
  };

  const stop = () => recorder.current?.state === 'recording' && recorder.current.stop();
  const discard = () => {
    setClip(null);
    setState('idle');
  };
  const send = () => {
    onRecorded(clip.file, clip.durationMs);
    discard();
  };

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
        <span className="w-10 text-sm tabular-nums">{fmtDuration(elapsed)}</span>
        <Button variant="soft" size="icon" onClick={stop} aria-label="Stop recording">
          <Square className="h-4 w-4 fill-current" />
        </Button>
      </div>
    );
  }
  if (state === 'review') {
    return (
      <div className="flex items-center gap-2">
        <audio src={clip.url} controls className="h-9 w-48" />
        <Button variant="ghost" size="icon" onClick={discard} aria-label="Discard voice note">
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button size="icon" onClick={send} aria-label="Send voice note">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    );
  }
  return (
    <Button variant="ghost" size="icon" onClick={start} disabled={disabled} aria-label="Record a voice note">
      <Mic className="h-5 w-5" />
    </Button>
  );
}
