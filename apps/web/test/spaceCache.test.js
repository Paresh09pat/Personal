import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { belongsToSpace, clearSpaceCache, flattenMessages, upsertMessage } from '@/lib/spaceCache';
import { qk } from '@/lib/queryKeys';
import { safeNext } from '@/lib/nav';

const AB = 'a'.repeat(24);
const AC = 'c'.repeat(24);

describe('belongsToSpace', () => {
  it('accepts only events for the space on screen', () => {
    expect(belongsToSpace(AB, { relationshipId: AB })).toBe(true);
    expect(belongsToSpace(AB, { relationshipId: AC })).toBe(false);
    expect(belongsToSpace(AB, {})).toBe(false);
    expect(belongsToSpace(AB, null)).toBe(false);
    expect(belongsToSpace(undefined, { relationshipId: AB })).toBe(false);
  });
});

describe('clearSpaceCache', () => {
  it('removes every query of the previous space and nothing else', () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.messages(AB), { pages: [] });
    qc.setQueryData(qk.section(AB, 'memories'), { items: [1] });
    qc.setQueryData(qk.relDetail(AB), { id: AB });
    qc.setQueryData(qk.messages(AC), { pages: [] });
    qc.setQueryData(qk.relationships, [{ id: AB }, { id: AC }]);

    clearSpaceCache(qc, AB);

    expect(qc.getQueryData(qk.messages(AB))).toBeUndefined();
    expect(qc.getQueryData(qk.section(AB, 'memories'))).toBeUndefined();
    expect(qc.getQueryData(qk.relDetail(AB))).toBeUndefined();
    expect(qc.getQueryData(qk.messages(AC))).toBeDefined();
    expect(qc.getQueryData(qk.relationships)).toBeDefined();
  });
});

describe('message cache helpers', () => {
  const msg = (id, rid, extra = {}) => ({ id, relationshipId: rid, clientId: `c${id}`, senderId: 'u1', body: id, ...extra });

  it('upsert appends new messages to the newest page and replaces existing ones', () => {
    const data = { pages: [{ messages: [msg('1', AB)] }] };
    const appended = upsertMessage(data, msg('2', AB));
    expect(appended.pages[0].messages.map((m) => m.id)).toEqual(['1', '2']);
    const replaced = upsertMessage(appended, msg('2', AB, { body: 'edited' }));
    expect(replaced.pages[0].messages).toHaveLength(2);
    expect(replaced.pages[0].messages[1].body).toBe('edited');
  });

  it('flatten never shows a message from another space, even if it slipped into the cache', () => {
    const data = { pages: [{ messages: [msg('3', AB), msg('x', AC)] }, { messages: [msg('1', AB)] }] };
    expect(flattenMessages(data, AB).map((m) => m.id)).toEqual(['1', '3']);
  });
});

describe('safeNext', () => {
  it('only allows same-site relative redirects', () => {
    expect(safeNext('/r/abc')).toBe('/r/abc');
    expect(safeNext('//evil.example')).toBe('/dashboard');
    expect(safeNext('https://evil.example')).toBe('/dashboard');
    expect(safeNext('/\\evil.example')).toBe('/dashboard');
    expect(safeNext(null)).toBe('/dashboard');
  });
});
