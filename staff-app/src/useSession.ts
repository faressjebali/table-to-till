import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  changePassword as postChangePassword,
  getMe,
  login as postLogin,
  logout as postLogout,
  setSessionLostListener,
} from './api/client';
import type { Me } from './api/types';
import { clearToken, loadToken, saveToken } from './session';

/** Pourquoi on est revenu à l'écran de connexion. */
export type SignedOutReason = 'expired' | 'disabled' | null;

export type SessionState =
  | { status: 'checking' }
  | { status: 'offline' }
  | { status: 'signed-out'; reason: SignedOutReason }
  | { status: 'must-change-password' }
  | { status: 'signed-in'; me: Me };

/**
 * Session du staff (docs/product.md § 5) : connexion une fois par téléphone (30 jours), changement
 * de mot de passe obligatoire à la première connexion, retour à la connexion dès que le serveur
 * refuse le jeton (expiré, déconnecté ailleurs, compte désactivé).
 */
export function useSession() {
  const [state, setState] = useState<SessionState>(() =>
    loadToken() ? { status: 'checking' } : { status: 'signed-out', reason: null },
  );

  const signOut = useCallback((reason: SignedOutReason) => {
    clearToken();
    setState({ status: 'signed-out', reason });
  }, []);

  // La session est-elle encore valable, le mot de passe à changer ? (démarrage, « Réessayer »,
  // après la connexion ou le changement de mot de passe)
  const refresh = useCallback(
    () =>
      getMe().then(
        (me) => setState({ status: 'signed-in', me }),
        (err: unknown) => {
          const code = err instanceof ApiError ? err.code : null;
          if (code === 'PASSWORD_CHANGE_REQUIRED') setState({ status: 'must-change-password' });
          // Session refusée (401, compte désactivé) : le listener ramène déjà à la connexion.
          else if (code !== 'UNAUTHORIZED' && code !== 'ACCOUNT_DISABLED') {
            setState({ status: 'offline' });
          }
        },
      ),
    [],
  );

  useEffect(() => {
    setSessionLostListener((code) => signOut(code === 'ACCOUNT_DISABLED' ? 'disabled' : 'expired'));
    return () => setSessionLostListener(null);
  }, [signOut]);

  // Au démarrage, avec un jeton enregistré : on vérifie la session une fois.
  useEffect(() => {
    if (loadToken()) void refresh();
  }, [refresh]);

  const retry = useCallback(() => {
    setState({ status: 'checking' });
    void refresh();
  }, [refresh]);

  /** Connexion ; les erreurs (identifiants, blocage, réseau) remontent à l'écran. */
  const login = useCallback(
    async (login: string, password: string) => {
      const { token, user } = await postLogin({ login, password });
      saveToken(token);
      if (user.mustChangePassword) setState({ status: 'must-change-password' });
      else await refresh();
    },
    [refresh],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await postChangePassword({ currentPassword, newPassword });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await postLogout();
    } catch {
      // Réseau coupé ou session déjà finie : on efface quand même la session du téléphone.
    }
    signOut(null);
  }, [signOut]);

  return { state, login, changePassword, logout, retry };
}
