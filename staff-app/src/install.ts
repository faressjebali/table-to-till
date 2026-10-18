// Installation de l'app sur le téléphone (docs/product.md § 5) : sur iPhone, les notifications ne
// marchent que si la PWA est sur l'écran d'accueil (iOS 16.4+), donc l'app l'exige.

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Ouverte depuis l'écran d'accueil (mode « standalone »). */
  standalone: boolean;
  /** HTTPS (ou localhost) : sans lui, ni installation ni notifications. */
  secure: boolean;
}

export function currentDevice(): DeviceInfo {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches,
    secure: window.isSecureContext,
  };
}

/** iPhone ou iPad (un iPad récent se présente comme un Mac tactile). */
export function isIos(device: DeviceInfo): boolean {
  return (
    /iPhone|iPad|iPod/.test(device.userAgent) ||
    (device.platform === 'MacIntel' && device.maxTouchPoints > 1)
  );
}

/**
 * Navigateur de l'iPhone, pour donner les bonnes étapes :
 * - `safari` : bouton Partager de Safari ;
 * - `other` : Chrome, Edge ou Firefox (iOS 16.4+), bouton Partager dans la barre d'adresse ;
 * - `in-app` : navigateur intégré d'une app (Facebook, Messenger, Instagram…), qui ne sait pas
 *   installer : il faut d'abord ouvrir le lien dans Safari.
 * WhatsApp ouvre les liens dans une vue Safari impossible à distinguer : l'écran dit toujours quoi
 * faire si « Sur l'écran d'accueil » n'apparaît pas.
 */
export function iosBrowser(device: DeviceInfo): 'safari' | 'other' | 'in-app' {
  const ua = device.userAgent;
  if (
    /FBAN|FBAV|FB_IAB|Instagram|Line\/|GSA\/|Snapchat|TikTok|LinkedInApp|Twitter|Pinterest/.test(ua)
  ) {
    return 'in-app';
  }
  if (/CriOS|FxiOS|EdgiOS/.test(ua)) return 'other';
  return 'safari';
}

/** Version d'iOS lue dans le navigateur (« iPhone OS 17_5 ») ; `null` si absente (iPad récent). */
export function iosVersion(device: DeviceInfo): [number, number] | null {
  const match = /OS (\d+)_(\d+)/.exec(device.userAgent);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** Les notifications d'une app installée sur iPhone demandent iOS 16.4 ou plus. */
const MIN_IOS: [number, number] = [16, 4];

/**
 * - `install-ios` : iPhone pas encore installé → écran qui bloque et explique comment l'installer ;
 * - `update-ios` : iPhone trop ancien pour les notifications → écran qui demande la mise à jour ;
 * - `none` : déjà installée, ou appareil sans exigence (Android, ordinateur).
 * On ne bloque pas quand l'installation est impossible : avec `npm run dev` (`requireInstall`
 * faux) ou sur une adresse http (`npm run preview` ouvert sur le Wi-Fi).
 */
export function installGate(
  device: DeviceInfo,
  requireInstall: boolean,
): 'install-ios' | 'update-ios' | 'none' {
  if (device.standalone || !requireInstall || !device.secure || !isIos(device)) return 'none';
  const version = iosVersion(device);
  if (
    version &&
    (version[0] < MIN_IOS[0] || (version[0] === MIN_IOS[0] && version[1] < MIN_IOS[1]))
  ) {
    return 'update-ios';
  }
  return 'install-ios';
}

/** Événement `beforeinstallprompt` (Chrome, Edge, Android) : bouton « Installer » de l'app. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
