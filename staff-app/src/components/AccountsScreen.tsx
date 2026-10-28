import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError, createUser, getUsers, resetUserPassword, updateUser } from '../api/client';
import type { Me, Role, User } from '../api/types';
import { t, type MessageKey } from '../i18n/fr';
import { roleLabel } from '../format';

// Rôles proposés à la création et au changement de rôle (docs/api.md § 1).
const ROLES: Role[] = ['waiter', 'barista', 'chef', 'manager', 'accountant'];
const TITLES = ['Manager', 'Patron', 'Patronne', 'Comptable'];

const lastLogin = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Africa/Tunis',
});

type View =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'account'; userId: number }
  | { kind: 'password'; user: User; password: string; reset: boolean };

// Comptes du staff (docs/product.md § 5 « Comptes et connexion »), manager seulement : créer un
// compte, changer le rôle ou le titre, réinitialiser le mot de passe, désactiver. Le mot de passe
// temporaire n'est montré qu'une fois, juste après la création ou la réinitialisation.
export function AccountsScreen({ me }: { me: Me }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });

  const load = useCallback(() => {
    getUsers().then(
      (res) => setUsers(res.users),
      () => setFailed(true),
    );
  }, []);
  useEffect(load, [load]);

  const replace = (user: User) => {
    setUsers((list) => {
      if (!list) return [user];
      return list.some((u) => u.id === user.id)
        ? list.map((u) => (u.id === user.id ? user : u))
        : [...list, user];
    });
  };
  const showPassword = (user: User, password: string, reset: boolean) => {
    replace(user);
    setView({ kind: 'password', user, password, reset });
  };

  if (view.kind === 'new') {
    return (
      <NewAccount
        onBack={() => setView({ kind: 'list' })}
        onCreated={(user, password) => showPassword(user, password, false)}
      />
    );
  }
  if (view.kind === 'password') {
    return (
      <TemporaryPassword
        user={view.user}
        password={view.password}
        reset={view.reset}
        onDone={() => setView({ kind: 'list' })}
      />
    );
  }
  const opened = view.kind === 'account' ? users?.find((u) => u.id === view.userId) : undefined;
  if (opened) {
    return (
      <AccountDetail
        key={opened.id}
        user={opened}
        me={me}
        onBack={() => setView({ kind: 'list' })}
        onChanged={replace}
        onReset={(user, password) => showPassword(user, password, true)}
        onGone={() => {
          setView({ kind: 'list' });
          load();
        }}
      />
    );
  }

  // Comptes actifs d'abord, puis les désactivés ; par nom dans chaque groupe (ordre du serveur).
  const sorted = users ? [...users].sort((a, b) => Number(b.active) - Number(a.active)) : [];
  return (
    <>
      <h1 className="title">{t('screen.accounts')}</h1>
      <button
        type="button"
        className="button button--block"
        onClick={() => setView({ kind: 'new' })}
      >
        {t('accounts.new')}
      </button>
      {failed ? (
        <div className="notice" role="alert">
          <p className="body">{t('accounts.error')}</p>
          <button
            type="button"
            className="button"
            onClick={() => {
              setFailed(false);
              load();
            }}
          >
            {t('session.retry')}
          </button>
        </div>
      ) : users === null ? (
        <p className="body" role="status">
          {t('accounts.loading')}
        </p>
      ) : (
        <ul className="rows">
          {sorted.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                className="row"
                onClick={() => setView({ kind: 'account', userId: user.id })}
              >
                <span className="row__text">
                  <span className="row__label">
                    {user.id === me.id ? `${user.name} (${t('accounts.you')})` : user.name}
                  </span>
                  <span className="row__hint">{roleLabel(user.role, user.title)}</span>
                  <AccountStates user={user} />
                </span>
                <span className="row__chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// Désactivé, bloqué (trop d'essais ratés), mot de passe temporaire pas encore changé.
function AccountStates({ user }: { user: User }) {
  const states: { key: MessageKey; danger?: boolean }[] = [];
  if (!user.active) states.push({ key: 'accounts.disabled', danger: true });
  if (user.locked) states.push({ key: 'accounts.locked', danger: true });
  if (user.mustChangePassword) states.push({ key: 'accounts.mustChange' });
  if (states.length === 0) return null;
  return (
    <span className="row__chips">
      {states.map(({ key, danger }) => (
        <span key={key} className={danger ? 'status-chip status-chip--danger' : 'status-chip'}>
          {t(key)}
        </span>
      ))}
    </span>
  );
}

function NewAccount({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (user: User, password: string) => void;
}) {
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [role, setRole] = useState<Role>('waiter');
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<{ name?: MessageKey; login?: MessageKey }>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const local: typeof errors = {};
    if (name.trim() === '') local.name = 'accounts.error.name';
    if (login.trim() === '') local.login = 'accounts.error.login';
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;

    setBusy(true);
    const trimmedTitle = title.trim();
    createUser({
      name: name.trim(),
      login: login.trim(),
      role,
      ...(trimmedTitle === '' ? {} : { title: trimmedTitle }),
    }).then(
      (res) => onCreated(res.user, res.temporaryPassword),
      (err: unknown) => {
        setBusy(false);
        if (fieldOf(err) === 'login') setErrors({ login: 'accounts.error.loginTaken' });
        else setFormError(errorText(err, null));
      },
    );
  };

  return (
    <>
      <button type="button" className="back" onClick={onBack}>
        ‹ {t('accounts.back')}
      </button>
      <h1 className="title">{t('accounts.new')}</h1>
      <form className="form" onSubmit={submit} noValidate>
        <TextField
          label={t('accounts.name')}
          hint={t('accounts.nameHint')}
          value={name}
          onChange={setName}
          error={errors.name}
          autoCapitalize="words"
        />
        <TextField
          label={t('login.login')}
          hint={t('login.loginHint')}
          value={login}
          onChange={setLogin}
          error={errors.login}
          autoCapitalize="none"
        />
        <RoleField value={role} onChange={setRole} />
        <TitleField value={title} onChange={setTitle} />
        {formError && (
          <p className="form__error" role="alert">
            {t(formError)}
          </p>
        )}
        <button type="submit" className="button button--block" disabled={busy}>
          {busy ? t('accounts.busy') : t('accounts.create')}
        </button>
      </form>
    </>
  );
}

// Mot de passe temporaire, montré une seule fois : la manager le dicte ou le recopie.
function TemporaryPassword({
  user,
  password,
  reset,
  onDone,
}: {
  user: User;
  password: string;
  reset: boolean;
  onDone: () => void;
}) {
  return (
    <>
      <h1 className="title">
        {t(reset ? 'accounts.password.reset' : 'accounts.password.created')}
      </h1>
      <p className="body">
        {user.name} · {t('login.login')} : <strong>{user.login}</strong>
      </p>
      <div className="secret">
        <p className="secret__label">{t('accounts.password.label')}</p>
        <p className="secret__value">{password}</p>
      </div>
      <p className="body">{t('accounts.password.body')}</p>
      <button type="button" className="button button--block" onClick={onDone}>
        {t('accounts.password.done')}
      </button>
    </>
  );
}

type Confirming = 'reset' | 'disable' | null;

function AccountDetail({
  user,
  me,
  onBack,
  onChanged,
  onReset,
  onGone,
}: {
  user: User;
  me: Me;
  onBack: () => void;
  onChanged: (user: User) => void;
  onReset: (user: User, password: string) => void;
  onGone: () => void;
}) {
  // On ne peut ni se désactiver soi-même ni retirer son propre rôle de manager (docs/api.md § 6).
  const self = user.id === me.id;
  const [role, setRole] = useState<Role>(user.role);
  const [title, setTitle] = useState(user.title ?? '');
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [saved, setSaved] = useState(false);

  const newTitle = title.trim() === '' ? null : title.trim();
  const changes = {
    ...(role === user.role ? {} : { role }),
    ...(newTitle === (user.title ?? null) ? {} : { title: newTitle }),
  };
  const changed = Object.keys(changes).length > 0;

  const run = <T,>(call: Promise<T>, done: (result: T) => void) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    call.then(
      (result) => {
        setBusy(false);
        setConfirming(null);
        done(result);
      },
      (err: unknown) => {
        setBusy(false);
        setConfirming(null);
        if (err instanceof ApiError && err.code === 'NOT_FOUND') onGone();
        else setError(errorText(err, user));
      },
    );
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !changed) return;
    run(updateUser(user.id, changes), (updated) => {
      onChanged(updated);
      setSaved(true);
    });
  };

  return (
    <>
      <button type="button" className="back" onClick={onBack}>
        ‹ {t('accounts.back')}
      </button>
      <h1 className="title">{user.name}</h1>
      <p className="badges">
        <span className="badge">{roleLabel(user.role, user.title)}</span>
      </p>
      <AccountStates user={user} />
      <p className="body">
        {t('login.login')} : <strong>{user.login}</strong>
        <br />
        {t('accounts.lastLogin')} :{' '}
        {user.lastLoginAt ? lastLogin.format(new Date(user.lastLoginAt)) : t('accounts.never')}
      </p>

      <form className="form" onSubmit={save} noValidate>
        {!self && <RoleField value={role} onChange={setRole} />}
        <TitleField value={title} onChange={setTitle} />
        <button type="submit" className="button button--block" disabled={busy || !changed}>
          {busy && confirming === null ? t('accounts.busy') : t('accounts.save')}
        </button>
      </form>

      {error && (
        <p className="form__error" role="alert">
          {t(error)}
        </p>
      )}
      {saved && (
        <p className="body" role="status">
          {t('accounts.saved')}
        </p>
      )}

      {confirming === 'reset' ? (
        <Confirm
          text={t('accounts.resetConfirm')}
          yes={t('accounts.resetYes')}
          danger={false}
          busy={busy}
          onYes={() =>
            run(resetUserPassword(user.id), (res) => onReset(res.user, res.temporaryPassword))
          }
          onNo={() => setConfirming(null)}
        />
      ) : (
        <button
          type="button"
          className="button button--secondary button--block"
          disabled={busy}
          onClick={() => setConfirming('reset')}
        >
          {t('accounts.reset')}
        </button>
      )}

      {!self &&
        (!user.active ? (
          <button
            type="button"
            className="button button--secondary button--block"
            disabled={busy}
            onClick={() => run(updateUser(user.id, { active: true }), onChanged)}
          >
            {t('accounts.enable')}
          </button>
        ) : confirming === 'disable' ? (
          <Confirm
            text={t('accounts.disableConfirm')}
            yes={t('accounts.disableYes')}
            danger
            busy={busy}
            onYes={() => run(updateUser(user.id, { active: false }), onChanged)}
            onNo={() => setConfirming(null)}
          />
        ) : (
          <button
            type="button"
            className="button button--danger button--block"
            disabled={busy}
            onClick={() => setConfirming('disable')}
          >
            {t('accounts.disable')}
          </button>
        ))}
    </>
  );
}

function Confirm({
  text,
  yes,
  danger,
  busy,
  onYes,
  onNo,
}: {
  text: string;
  yes: string;
  danger: boolean;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="confirm" role="group" aria-label={yes}>
      <p className="confirm__text">{text}</p>
      <button
        type="button"
        className={danger ? 'button button--danger' : 'button'}
        disabled={busy}
        onClick={onYes}
      >
        {busy ? t('accounts.busy') : yes}
      </button>
      <button type="button" className="button button--secondary" disabled={busy} onClick={onNo}>
        {t('accounts.cancel')}
      </button>
    </div>
  );
}

function TextField({
  label,
  hint,
  value,
  onChange,
  error,
  autoCapitalize,
  list,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: MessageKey | undefined;
  autoCapitalize: 'none' | 'words';
  list?: string;
}) {
  const id = useId();
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
      <input
        id={id}
        className="field__input"
        type="text"
        value={value}
        maxLength={100}
        autoComplete="off"
        autoCapitalize={autoCapitalize}
        autoCorrect="off"
        spellCheck={false}
        list={list}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
        }
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p className="field__error" id={`${id}-error`}>
          {t(error)}
        </p>
      )}
    </div>
  );
}

function RoleField({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {t('accounts.role')}
      </label>
      <select
        id={id}
        className="field__input"
        value={value}
        onChange={(event) => onChange(event.target.value as Role)}
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {t(`role.${role}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

// Titre libre, avec les titres habituels proposés par le clavier.
function TitleField({ value, onChange }: { value: string; onChange: (title: string) => void }) {
  const listId = useId();
  return (
    <>
      <TextField
        label={t('accounts.title')}
        hint={t('accounts.titleHint')}
        value={value}
        onChange={onChange}
        autoCapitalize="words"
        list={listId}
      />
      <datalist id={listId}>
        {TITLES.map((title) => (
          <option key={title} value={title} />
        ))}
      </datalist>
    </>
  );
}

/** Champ visé par une erreur `VALIDATION_ERROR` (`details.fields[0].field`). */
function fieldOf(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return null;
  const fields = err.details['fields'];
  const first = Array.isArray(fields) ? (fields[0] as { field?: string } | undefined) : undefined;
  return first?.field ?? null;
}

// Refus du serveur en phrase claire. 409 `INVALID_STATUS` : serveur en shift, ou dernier manager
// actif (les actions sur son propre compte ne sont pas proposées).
function errorText(err: unknown, user: User | null): MessageKey {
  if (!(err instanceof ApiError)) return 'login.error.other';
  if (err.code === 'NETWORK') return 'login.error.network';
  if (err.code === 'VALIDATION_ERROR') return 'accounts.error.refused';
  if (err.code === 'NOT_FOUND') return 'accounts.error.gone';
  if (err.code === 'INVALID_STATUS' && user) {
    return user.role === 'waiter' ? 'accounts.error.inShift' : 'accounts.error.lastManager';
  }
  return 'login.error.other';
}
