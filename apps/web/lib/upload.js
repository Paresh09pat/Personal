import { CSRF_HEADER } from '@olw/shared';
import { api, relUrl } from './api';

/**
 * Private upload into ONE space: ask the server for a slot (it checks membership), PUT the bytes to
 * the short-lived URL, then confirm (the server verifies size + real file type).
 */
export async function uploadToSpace(rid, file, { purpose = 'message', durationMs } = {}) {
  const mime = (file.type || 'application/octet-stream').split(';')[0].trim();
  const { attachment, upload } = await api.post(relUrl(rid, '/attachments'), {
    fileName: file.name || 'file',
    mime,
    size: file.size,
    purpose,
    ...(durationMs ? { durationMs: Math.round(durationMs) } : {}),
  });
  const res = await fetch(upload.url, {
    method: upload.method,
    body: file,
    credentials: upload.sameOrigin ? 'same-origin' : 'omit',
    headers: {
      ...upload.headers,
      ...(upload.sameOrigin ? { [CSRF_HEADER]: '1', 'Content-Type': mime } : {}),
    },
  });
  if (!res.ok) throw new Error('Upload failed. Please try again.');
  const done = await api.post(relUrl(rid, `/attachments/${attachment.id}/complete`));
  return done.attachment;
}

export const isVideo = (a) => a.kind === 'video';
export const isImage = (a) => a.kind === 'image';
