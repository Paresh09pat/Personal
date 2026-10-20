import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (algorithm 2 = argon2id).
const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };

let dummyHash;

export const hashPassword = (password) => hash(password, OPTIONS);

export async function verifyPassword(passwordHash, password) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Burn the same CPU time when the account doesn't exist, so timing doesn't reveal accounts. */
export async function verifyDummy(password) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(dummyHash, password);
  return false;
}
