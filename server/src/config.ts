// Réglages lus dans .env. Chaque réglage a une valeur par défaut : un .env sans eux fonctionne.

export type Config = {
  sessionDays: number;
  loginMaxFailures: number;
  loginLockMinutes: number;
  loginRateLimitPerMinute: number;
  firstManagerLogin: string;
  firstManagerTempPassword: string;
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

export function loadConfig(): Config {
  return {
    sessionDays: positiveInt('SESSION_DAYS', 30),
    // Fixé par la spec : blocage après 5 essais ratés.
    loginMaxFailures: 5,
    loginLockMinutes: positiveInt('LOGIN_LOCK_MINUTES', 5),
    loginRateLimitPerMinute: positiveInt('LOGIN_RATE_LIMIT_PER_MINUTE', 10),
    firstManagerLogin: process.env.FIRST_MANAGER_LOGIN ?? '',
    firstManagerTempPassword: process.env.FIRST_MANAGER_TEMP_PASSWORD ?? '',
  };
}
