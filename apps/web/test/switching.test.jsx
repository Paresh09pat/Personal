import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';

const AB = 'a'.repeat(24);
const AC = 'c'.repeat(24);
let currentRid = AB;

vi.mock('next/navigation', () => ({
  useParams: () => ({ rid: currentRid }),
  usePathname: () => `/r/${currentRid}`,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const { SpaceShell, useSpace } = await import('@/components/SpaceShell');
const { ChatList } = await import('@/components/ChatList');

const space = (id, partnerName) => ({
  id,
  status: 'active',
  title: '',
  preferences: { accent: 'rose' },
  me: { userId: 'me', role: 'owner', displayName: 'Me' },
  partner: { userId: `p-${id}`, displayName: partnerName, avatarUrl: null },
  partnerActive: true,
  unreadCount: 0,
});

function Probe() {
  const { rid, partner } = useSpace();
  return <p data-testid="probe">{`${rid}:${partner.displayName}`}</p>;
}

beforeEach(() => {
  global.fetch = vi.fn(async (url) => {
    const id = String(url).split('/')[3];
    const body = id === AB ? space(AB, 'Bella') : id === AC ? space(AC, 'Cleo') : null;
    return { ok: Boolean(body), status: body ? 200 : 404, json: async () => (body ? { relationship: body } : { error: { message: 'Not found' } }) };
  });
});
afterEach(() => cleanup());

describe('relationship switching', () => {
  it('remounts per space, clears the previous space cache, and never shows old data', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (rid) => (
      <QueryClientProvider client={qc}>
        <SpaceShell key={rid} rid={rid}>
          <Probe />
        </SpaceShell>
      </QueryClientProvider>
    );

    currentRid = AB;
    const { rerender } = render(view(AB));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe(`${AB}:Bella`));
    qc.setQueryData(qk.messages(AB), { pages: [{ messages: [{ id: 'm1', relationshipId: AB }] }] });

    currentRid = AC;
    await act(async () => rerender(view(AC)));
    // AB's cache is gone the moment we switch.
    expect(qc.getQueryData(qk.messages(AB))).toBeUndefined();
    expect(qc.getQueryData(qk.relDetail(AB))).toBeUndefined();
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe(`${AC}:Cleo`));
    expect(screen.queryByText(/Bella/)).toBeNull();
  });

  it('a space the server refuses (404) shows "not available", whatever the URL says', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    currentRid = 'f'.repeat(24);
    render(
      <QueryClientProvider client={qc}>
        <SpaceShell rid={currentRid}>
          <Probe />
        </SpaceShell>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/isn't available/)).toBeTruthy());
    expect(screen.queryByTestId('probe')).toBeNull();
  });

  it('the chat list shows only the spaces the server returned, each linking to its own space', async () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.me, { user: { id: 'me', displayName: 'Bella', isAdmin: false, emailVerified: true } });
    qc.setQueryData(qk.relationships, [space(AB, 'Alex')]);
    currentRid = AB;
    render(
      <QueryClientProvider client={qc}>
        <ChatList createOpen={false} onCreateOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    const rows = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/r/'));
    expect(rows.map((a) => a.getAttribute('href'))).toEqual([`/r/${AB}`]);
    expect(screen.getByText('Alex')).toBeTruthy();
    expect(screen.queryByText('Cleo')).toBeNull();
    // Members can't start new chats; only the admin can.
    expect(screen.queryByLabelText('New chat')).toBeNull();
  });

  it('the admin sees the "new chat" action', async () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.me, { user: { id: 'me', displayName: 'Alex', isAdmin: true, emailVerified: true } });
    qc.setQueryData(qk.relationships, [space(AB, 'Bella'), space(AC, 'Cleo')]);
    render(
      <QueryClientProvider client={qc}>
        <ChatList createOpen={false} onCreateOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('New chat')).toBeTruthy();
    expect(screen.getByText('Bella')).toBeTruthy();
    expect(screen.getByText('Cleo')).toBeTruthy();
  });
});
