'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { EVENTS } from '@olw/shared';
import { useMe } from '@/lib/hooks';
import { qk } from '@/lib/queryKeys';
import { clearSpaceCache } from '@/lib/spaceCache';
import { useToast } from './Toast';

const SocketContext = createContext(null);

/**
 * One authenticated socket per signed-in browser tab. The server decides which rooms it may join;
 * here we only listen to the user's private channel (dashboard badges, notifications).
 */
export function SocketProvider({ children }) {
  const { data: me } = useMe();
  const userId = me?.user?.id;
  const queryClient = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();

  // A new socket per signed-in user; it only connects inside the effect (and disconnects on change).
  const socket = useMemo(
    () => (userId ? io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], autoConnect: false }) : null),
    [userId],
  );
  useEffect(() => {
    if (!socket) return undefined;
    socket.connect();
    return () => socket.disconnect();
  }, [socket]);

  useEffect(() => {
    if (!socket) return undefined;
    const onNotify = (n) => {
      queryClient.invalidateQueries({ queryKey: qk.relationships });
      const viewingThatChat = pathname === `/r/${n.relationshipId}`;
      if (!n.silent && !viewingThatChat && n.type !== 'call') {
        const who = n.kind === 'group' && n.fromName ? `${n.fromName}: ` : '';
        toast(n.type === 'message' ? `${who || 'New message: '}${n.text || '💌'}` : n.text || 'Something new for you 💗', {
          href: `/r/${n.relationshipId}`,
        });
      }
    };
    const onRelUpdated = () => queryClient.invalidateQueries({ queryKey: qk.relationships });
    const onRemoved = ({ relationshipId }) => {
      clearSpaceCache(queryClient, relationshipId);
      queryClient.invalidateQueries({ queryKey: qk.relationships });
      if (pathname.startsWith(`/r/${relationshipId}`)) router.replace('/dashboard');
    };
    socket.on(EVENTS.NOTIFY, onNotify);
    socket.on(EVENTS.RELATIONSHIP_UPDATED, onRelUpdated);
    socket.on(EVENTS.RELATIONSHIP_REMOVED, onRemoved);
    return () => {
      socket.off(EVENTS.NOTIFY, onNotify);
      socket.off(EVENTS.RELATIONSHIP_UPDATED, onRelUpdated);
      socket.off(EVENTS.RELATIONSHIP_REMOVED, onRemoved);
    };
  }, [socket, queryClient, toast, pathname, router]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
