import { afterAll, beforeAll, expect, it } from 'vitest';
import { makeClient, startTestApp } from './helpers.js';

let t;
beforeAll(async () => {
  t = await startTestApp({ rateLimit: { enabled: true, loginIdentifier: 3, invitation: 4 } });
});
afterAll(() => t?.close());

it('login attempts are rate limited per identifier', async () => {
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    statuses.push((await makeClient(t).post('/api/auth/login', { identifier: 'target', password: 'x' })).status);
  }
  expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
  expect(statuses.slice(3)).toEqual([429, 429]);
});

it('invitation guessing is rate limited', async () => {
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    statuses.push((await makeClient(t).post('/api/invitations/preview', { token: `guess-${i}-xxxxxxxxxxxxxxxxxxxx` })).status);
  }
  expect(statuses.slice(0, 4)).toEqual([404, 404, 404, 404]);
  expect(statuses.slice(4)).toEqual([429, 429]);
});
