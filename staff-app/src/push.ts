// Notifications push : le téléphone sonne pour une nouvelle commande même verrouillé.
// Sur iPhone, seulement dans l'app installée sur l'écran d'accueil (iOS 16.4+) : ailleurs,
// PushManager n'existe pas et l'app marche sans (Socket.IO, son).
import { subscribePush } from './api/client';

/**
 * - `unsupported` : navigateur sans push, app pas installée sur iPhone, version de développement
 *   (pas de service worker) ou clé publique absente ;
 * - `ask` : à demander, par un tap (obligatoire sur iPhone) ;
 * - `denied` : refusé, à réactiver dans les réglages du téléphone ;
 * - `on` : accepté.
 */
export type PushState = 'unsupported' | 'ask' | 'denied' | 'on';

/** Clé publique VAPID, la même que `VAPID_PUBLIC_KEY` du serveur (voir README). */
const PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';

export function pushState({
  publicKey = PUBLIC_KEY,
  enabled = import.meta.env.PROD,
}: {
  publicKey?: string;
  enabled?: boolean;
} = {}): PushState {
  if (
    !enabled ||
    publicKey === '' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'on';
  if (Notification.permission === 'denied') return 'denied';
  return 'ask';
}

/** Clé VAPID en base64url → octets, comme l'attend `pushManager.subscribe`. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/**
 * Abonne ce téléphone et l'envoie au serveur (`POST /push/subscribe`), qui le lie à la session :
 * à refaire à chaque connexion. Un abonnement déjà présent est réutilisé.
 */
export async function syncSubscription(publicKey = PUBLIC_KEY): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  await subscribePush(subscription.toJSON());
}

/** Demande l'autorisation (au tap du bouton), puis abonne. Renvoie le nouvel état. */
export async function enablePush(publicKey = PUBLIC_KEY): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'ask';
  await syncSubscription(publicKey);
  return 'on';
}
