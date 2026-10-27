// Réglages lus dans .env. Chaque réglage a une valeur par défaut : un .env sans eux fonctionne.

export type Config = {
  sessionDays: number;
  loginMaxFailures: number;
  loginLockMinutes: number;
  loginRateLimitPerMinute: number;
  firstManagerLogin: string;
  firstManagerTempPassword: string;
  // Commande QR non confirmée : expirée après ce délai (docs/api.md § Order).
  orderPendingTtlSeconds: number;
  // Anti-abus : commandes QR par table sur une fenêtre (docs/api.md § Erreurs).
  qrOrderRateLimit: number;
  qrOrderRateWindowMinutes: number;
  // Clé partagée avec l'agent caisse (X-Agent-Key, auth Socket.IO). Vide : aucun agent accepté.
  agentKey: string;
  // Heure (Africa/Tunis, "HH:MM") où les shifts oubliés se terminent (docs/api.md § 5).
  shiftAutoEndTime: string;
  // Web Push. Une clé vide : aucune notification push envoyée.
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  // Nombre de proxys devant le serveur (hébergeur, tunnel) dont on croit X-Forwarded-For : sans
  // lui, toutes les requêtes ont l'adresse du proxy (limite de connexion par IP). 0 : aucun.
  trustProxy: number;
  // Chemin de l'app staff (« / » ou « /staff/ ») où le serveur la sert avec SERVE_WEB. Le même
  // réglage sert de `base` au build de staff-app.
  staffBasePath: string;
  // Le serveur sert aussi les deux apps construites : menu QR à la racine, app staff sous
  // staffBasePath. Faux en local : chaque app a son serveur Vite.
  serveWeb: boolean;
};

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} doit être un entier positif (reçu : ${raw})`);
  }
  return value;
}

function timeOfDay(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
    throw new Error(`${name} doit être une heure HH:MM (reçu : ${raw})`);
  }
  return raw;
}

function nonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} doit être un entier positif ou nul (reçu : ${raw})`);
  }
  return value;
}

function basePath(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\/([a-z0-9-]+\/)*$/.test(raw)) {
    throw new Error(`${name} doit être un chemin comme /staff/ (reçu : ${raw})`);
  }
  return raw;
}

function bool(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new Error(`${name} doit être true ou false (reçu : ${raw})`);
}

export function loadConfig(): Config {
  const config: Config = {
    sessionDays: positiveInt('SESSION_DAYS', 30),
    // Fixé par la spec : blocage après 5 essais ratés.
    loginMaxFailures: 5,
    loginLockMinutes: positiveInt('LOGIN_LOCK_MINUTES', 5),
    loginRateLimitPerMinute: positiveInt('LOGIN_RATE_LIMIT_PER_MINUTE', 10),
    firstManagerLogin: process.env.FIRST_MANAGER_LOGIN ?? '',
    firstManagerTempPassword: process.env.FIRST_MANAGER_TEMP_PASSWORD ?? '',
    orderPendingTtlSeconds: positiveInt('ORDER_PENDING_TTL_SECONDS', 300),
    qrOrderRateLimit: positiveInt('QR_ORDER_RATE_LIMIT', 10),
    qrOrderRateWindowMinutes: positiveInt('QR_ORDER_RATE_WINDOW_MINUTES', 10),
    agentKey: process.env.AGENT_KEY ?? '',
    shiftAutoEndTime: timeOfDay('SHIFT_AUTO_END_TIME', '04:00'),
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    vapidSubject: process.env.VAPID_SUBJECT ?? '',
    trustProxy: nonNegativeInt('TRUST_PROXY', 0),
    staffBasePath: basePath('STAFF_BASE_PATH', '/'),
    serveWeb: bool('SERVE_WEB'),
  };
  if (config.serveWeb && config.staffBasePath === '/') {
    throw new Error(
      'SERVE_WEB=true demande STAFF_BASE_PATH (ex. /staff/) : le menu QR est à la racine',
    );
  }
  return config;
}
