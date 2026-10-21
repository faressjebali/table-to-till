import { createHash } from 'node:crypto';
import webpush from 'web-push';
import type { Config } from '../config.js';
import type { Db } from '../db.js';

// Notifications Web Push, en plus des événements Socket.IO : le téléphone verrouillé ou
// l'app fermée doit quand même sonner. Contenu minimal (jamais de note ni de montant) : le
// détail se lit dans l'app.

export type PushType = 'order:new' | 'station:order' | 'order:ready' | 'closure:missing';

export type PushMessage = {
  type: PushType;
  // Une notification par événement : le même tag remplace la précédente sur le téléphone
  // (ex. `order-12`, `ready-12-bar`).
  tag: string;
  title: string;
  body: string;
  // Page ouverte au toucher de la notification.
  url: string;
};

export type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

// Abonnement supprimé ou expiré chez le service push (404, 410) : à oublier.
export class PushGone extends Error {}

// Envoie un message chiffré à un abonnement. Remplacé dans les tests.
export type PushSender = (subscription: PushSubscription, message: PushMessage) => Promise<void>;

export const noopPushSender: PushSender = () => Promise.resolve();

// Une notification de plus de 5 minutes ne sert plus (commande expirée, déjà vue dans l'app).
const TTL_SECONDS = 300;

// En-tête Topic (RFC 8030) : 32 caractères base64url au plus. Le service push d'Apple le lit
// comme du base64 et refuse (400 BadWebPushTopic) une longueur de la forme 4n + 1, ex.
// `order-123` ou `station-8-bar` : on envoie donc une empreinte du tag, toujours de 32
// caractères. Le tag lui-même reste dans le message (notification remplacée sur le téléphone).
export function pushTopic(tag: string): string {
  return createHash('sha256').update(tag).digest('base64url').slice(0, 32);
}

// Sans clés VAPID : null (aucun push, l'app marche avec Socket.IO seulement).
export function webPushSender(config: Config): PushSender | null {
  if (config.vapidPublicKey === '' || config.vapidPrivateKey === '' || config.vapidSubject === '') {
    return null;
  }
  const vapidDetails = {
    subject: config.vapidSubject,
    publicKey: config.vapidPublicKey,
    privateKey: config.vapidPrivateKey,
  };
  return async (subscription, message) => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(message), {
        vapidDetails,
        TTL: TTL_SECONDS,
        urgency: 'high',
        // Un message pas encore livré est remplacé par le suivant du même tag.
        topic: pushTopic(message.tag),
      });
    } catch (err) {
      if (err instanceof webpush.WebPushError && [404, 410].includes(err.statusCode)) {
        throw new PushGone(err.message);
      }
      throw err;
    }
  };
}

type SubscriptionRow = { id: number; endpoint: string; p256dh: string; auth: string };

// Envoie un message aux téléphones de ces comptes : sessions encore valides, comptes actifs
// qui ont changé leur mot de passe temporaire. Ne lève jamais : un push raté ne doit pas faire
// échouer l'action déjà enregistrée (les apps rechargent via REST et Socket.IO).
export async function sendPush(
  db: Db,
  sender: PushSender,
  userIds: readonly number[],
  message: PushMessage,
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const { rows } = await db.query<SubscriptionRow>(
      `SELECT p.id, p.endpoint, p.p256dh, p.auth
         FROM push_subscriptions p
         JOIN sessions s ON s.id = p.session_id
         JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ANY($1::int[]) AND s.revoked_at IS NULL AND s.expires_at > now()
          AND u.disabled_at IS NULL AND NOT u.must_change_password`,
      [userIds],
    );
    await Promise.all(
      rows.map(async (row) => {
        try {
          await sender(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            message,
          );
        } catch (err) {
          if (err instanceof PushGone) {
            await db.query(`DELETE FROM push_subscriptions WHERE id = $1`, [row.id]);
            return;
          }
          console.error('notification push :', err);
        }
      }),
    );
  } catch (err) {
    console.error('notifications push :', err);
  }
}
