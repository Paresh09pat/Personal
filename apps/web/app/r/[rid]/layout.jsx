'use client';

import { useParams } from 'next/navigation';
import { ChatLayout } from '@/components/ChatLayout';
import { SpaceShell } from '@/components/SpaceShell';

export default function SpaceLayout({ children }) {
  const { rid } = useParams();
  return (
    <ChatLayout chatOpen>
      {/* key={rid}: switching chats remounts everything, so no state can leak between spaces. */}
      <SpaceShell key={rid} rid={rid}>
        {children}
      </SpaceShell>
    </ChatLayout>
  );
}
