import { useId, useState } from 'react';
import { t } from '../i18n/fr';

// Champ mot de passe avec « Afficher » (taper un mot de passe sur un téléphone, d'une main).
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  error?: string | null;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <div className="field__row">
        <input
          id={id}
          className="field__input"
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
          }
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="field__toggle"
          aria-pressed={visible}
          aria-label={t('login.show')}
          onClick={() => setVisible((v) => !v)}
        >
          <EyeIcon open={visible} />
        </button>
      </div>
      {error && (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      {!open && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" />}
    </svg>
  );
}
