import mongoose from 'mongoose';
import { HttpError, notFound } from './errors.js';

export function parse(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new HttpError(422, result.error.issues[0]?.message ?? 'Invalid input', {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

/**
 * For PATCH routes: parse with the partial schema, then keep only keys the client actually sent,
 * so schema defaults never overwrite stored values.
 */
export function parsePatch(schema, input) {
  const data = parse(schema.partial(), input);
  const raw = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(Object.entries(data).filter(([k]) => Object.hasOwn(raw, k)));
}

/** Validates an id from a URL/payload. Malformed ids are treated as "not found", never as errors. */
export function toObjectId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) throw notFound();
  return new mongoose.Types.ObjectId(value);
}

export const sameId = (a, b) => a != null && b != null && String(a) === String(b);
