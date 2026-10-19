/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clé publique VAPID des notifications push (même valeur que `VAPID_PUBLIC_KEY` du serveur). */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}
