'use client';

import { useState } from 'react';
import { RequireAuth } from './RequireAuth';
import { ChatList } from './ChatList';
import { cx } from './ui';

/**
 * Two-pane layout like WhatsApp Web: chat list on the left, the open chat on the right.
 * On phones only one pane is visible: the list (no chat open) or the chat (with a back button).
 */
export function ChatLayout({ children, chatOpen }) {
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <RequireAuth>
      <div className="mx-auto flex h-dvh max-w-[1600px] overflow-hidden md:p-4">
        <aside
          className={cx(
            'glass w-full shrink-0 flex-col overflow-hidden bg-surface-solid/90 md:flex md:w-[360px] md:rounded-l-[2rem] md:border-r-0 lg:w-[400px]',
            chatOpen ? 'hidden' : 'flex',
          )}
        >
          <ChatList createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
        </aside>
        <main
          className={cx(
            'glass min-w-0 flex-1 flex-col overflow-hidden md:flex md:rounded-r-[2rem]',
            chatOpen ? 'flex' : 'hidden',
          )}
        >
          {typeof children === 'function' ? children({ openCreate: () => setCreateOpen(true) }) : children}
        </main>
      </div>
    </RequireAuth>
  );
}
