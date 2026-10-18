import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { t, type MessageKey } from '../i18n/fr';
import type { SignedOutReason } from '../useSession';
import { PasswordField } from './PasswordField';

const ERRORS: Record<string, MessageKey> = {
  UNAUTHORIZED: 'login.error.credentials',
  VALIDATION_ERROR: 'login.error.credentials',
  ACCOUNT_LOCKED: 'login.error.locked',
  ACCOUNT_DISABLED: 'login.error.disabled',
  TOO_MANY_REQUESTS: 'login.error.tooMany',
  NETWORK: 'login.error.network',
};

// Connexion : identifiant (téléphone ou nom d'utilisateur) + mot de passe (docs/product.md § 5).
export function LoginScreen({
  reason,
  onLogin,
}: {
  reason: SignedOutReason;
  onLogin: (login: string, password: string) => Promise<void>;
}) {
  const loginId = useId();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(
    reason === 'expired' ? 'login.expired' : reason === 'disabled' ? 'login.error.disabled' : null,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (login.trim() === '' || password === '') {
      setError('login.error.credentials');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onLogin(login.trim(), password);
    } catch (err) {
      setError((err instanceof ApiError && ERRORS[err.code]) || 'login.error.other');
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <img className="auth__icon" src="/icons/apple-touch-icon.png" alt="" width={72} height={72} />
      <h1 className="title">{t('login.title')}</h1>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label className="field__label" htmlFor={loginId}>
            {t('login.login')}
          </label>
          <p className="field__hint" id={`${loginId}-hint`}>
            {t('login.loginHint')}
          </p>
          <input
            id={loginId}
            className="field__input"
            value={login}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={`${loginId}-hint`}
            onChange={(event) => setLogin(event.target.value)}
          />
        </div>
        <PasswordField
          label={t('login.password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {error && (
          <p className="form__error" role="alert">
            {t(error)}
          </p>
        )}
        <button type="submit" className="button button--block" disabled={busy}>
          {busy ? t('login.busy') : t('login.submit')}
        </button>
      </form>
    </main>
  );
}
