import { useEffect, useState } from 'react';
import type { InstallPromptEvent } from './install';

/**
 * Proposition d'installation du navigateur (Android, Chrome, Edge) : `install` l'ouvre ; `null`
 * quand le navigateur ne la propose pas (iPhone, déjà installée).
 */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Le navigateur n'affiche pas sa propre bannière : l'app propose son bouton.
      e.preventDefault();
      setEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!event) return null;
  // Une proposition ne sert qu'une fois : on l'oublie avant de l'ouvrir (un double tap ne peut
  // pas la rouvrir), et une erreur du navigateur ne doit pas laisser un bouton qui ne fait rien.
  return async () => {
    setEvent(null);
    try {
      await event.prompt();
      await event.userChoice;
    } catch {
      // Proposition refusée par le navigateur : le bouton a déjà disparu.
    }
  };
}
