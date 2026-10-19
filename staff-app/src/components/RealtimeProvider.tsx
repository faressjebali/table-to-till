import { useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { RealtimeContext } from '../realtime';
import { loadToken } from '../session';

// Connexion temps réel du téléphone connecté (src/realtime.ts), fermée quand l'écran disparaît.
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [socket] = useState<Socket>(() =>
    io({ autoConnect: false, auth: { token: loadToken() ?? '' } }),
  );

  useEffect(() => {
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  return <RealtimeContext.Provider value={socket}>{children}</RealtimeContext.Provider>;
}
