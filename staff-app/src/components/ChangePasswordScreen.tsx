import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { t, type MessageKey } from '../i18n/fr';
import { PasswordField } from './PasswordField';

const MIN_LENGTH = 8;
type Field = 'current' | 'new' | 'confirm';

/** Erreur du serveur (`VALIDATION_ERROR`, `details.fields`) → champ et message. */
function serverFieldError(err: unknown): [Field, MessageKey] | null {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return null;
  const fields = err.details['fields'];
  const first = Array.isArray(fields)
    ? (fields[0] as { field?: string; message?: string } | undefined)
    : undefined;
  if (first?.field === 'currentPassword') return ['current', 'password.error.current'];
  if (first?.field === 'newPassword') {
    const message = first.message ?? '';
    if (/login/i.test(message)) return ['new', 'password.error.login'];
    if (/current/i.test(message)) return ['new', 'password.error.same'];
    return ['new', 'password.error.tooShort'];
  }
  return null;
}

// Première connexion : le mot de passe temporaire est remplacé avant tout le reste.
export function ChangePasswordScreen({
  onChange,
  onLogout,
}: {
  onChange: (currentPassword: string, newPassword: string) => Promise<void>;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, MessageKey>>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const local: Partial<Record<Field, MessageKey>> = {};
    if (current === '') local.current = 'password.error.current';
    if (next.length < MIN_LENGTH) local.new = 'password.error.tooShort';
    else if (next === current) local.new = 'password.error.same';
    if (confirm !== next) local.confirm = 'password.error.mismatch';
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;

    setBusy(true);
    try {
      await onChange(current, next);
    } catch (err) {
      const fieldError = serverFieldError(err);
      if (fieldError) setErrors({ [fieldError[0]]: fieldError[1] });
      else
        setFormError(
          err instanceof ApiError && err.code === 'NETWORK'
            ? 'login.error.network'
            : 'login.error.other',
        );
      setBusy(false);
    }
  };

  const error = (field: Field) => (errors[field] ? t(errors[field]) : null);

  return (
    <main className="auth">
      <h1 className="title">{t('password.title')}</h1>
      <p className="body">{t('password.body')}</p>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <PasswordField
          label={t('password.current')}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          error={error('current')}
        />
        <PasswordField
          label={t('password.new')}
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint={t('password.newHint')}
          error={error('new')}
        />
        <PasswordField
          label={t('password.confirm')}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          error={error('confirm')}
        />
        {formError && (
          <p className="form__error" role="alert">
            {t(formError)}
          </p>
        )}
        <button type="submit" className="button button--block" disabled={busy}>
          {busy ? t('password.busy') : t('password.submit')}
        </button>
      </form>
      <button type="button" className="link-button" onClick={onLogout}>
        {t('session.logout')}
      </button>
    </main>
  );
}
