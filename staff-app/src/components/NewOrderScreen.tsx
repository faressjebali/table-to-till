import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError, createStaffOrder, getCurrentShifts, getMenu } from '../api/client';
import type {
  CurrentShifts,
  MenuItem,
  MenuResponse,
  Order,
  StationName,
  Table,
} from '../api/types';
import { formatPrice } from '../format';
import { t } from '../i18n/fr';
import { nobodyText, unstaffedStations } from '../pendingOrders';
import { useOnConnect, useRealtimeEvent } from '../realtime';
import {
  addSelection,
  applyMenuUpdate,
  countOf,
  draftCount,
  draftTotal,
  groupsOf,
  isShown,
  itemsById,
  linesWithItem,
  loadDraft,
  matches,
  MAX_LINES,
  MAX_NOTE_LENGTH,
  MAX_QUANTITY,
  newRequestId,
  orderLines,
  quickAdd,
  removeLine,
  saveDraft,
  setQuantity,
  type DraftChoice,
  type DraftLine,
} from '../staffOrder';
import { StateIcon } from './StateIcon';

type MenuState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; menu: MenuResponse };

type View = { kind: 'menu' } | { kind: 'item'; itemId: number } | { kind: 'review' };

// Saisir une commande pour une table (docs/product.md § 5 et § 6, `POST /staff-orders`) : pour un
// client sans téléphone. La carte (recherche, catégories), la fiche d'un article (choix, extras,
// quantité, note), puis le récapitulatif et l'envoi. La commande est confirmée tout de suite : elle
// part en caisse et sur l'écran bar / cuisine. Le brouillon est gardé si l'envoi échoue.
export function NewOrderScreen({
  table,
  onSent,
  onBack,
}: {
  table: Table;
  /** Commande créée ; `missing` : postes sans personne en shift pour ses lignes. */
  onSent: (order: Order, missing: StationName[]) => void;
  onBack: () => void;
}) {
  const [menuState, setMenuState] = useState<MenuState>({ status: 'loading' });
  const [shifts, setShifts] = useState<CurrentShifts | null>(null);
  const [lines, setLines] = useState<DraftLine[]>(() => loadDraft(table.id));
  const [view, setView] = useState<View>({ kind: 'menu' });
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Même identifiant tant que le brouillon ne change pas : un envoi renvoyé ne crée pas de doublon.
  const requestId = useRef<string | null>(null);

  const loadMenu = useCallback(() => {
    getMenu().then(
      (menu) => setMenuState({ status: 'ready', menu }),
      () => setMenuState((s) => (s.status === 'ready' ? s : { status: 'error' })),
    );
  }, []);
  const loadShifts = useCallback(() => {
    getCurrentShifts().then(setShifts, () => undefined);
  }, []);
  useEffect(() => {
    loadMenu();
    loadShifts();
  }, [loadMenu, loadShifts]);
  useOnConnect(() => {
    loadMenu();
    loadShifts();
  });
  useRealtimeEvent('menu:updated', (update) => {
    setMenuState((s) =>
      s.status === 'ready' ? { ...s, menu: applyMenuUpdate(s.menu, update) } : s,
    );
  });

  const changeLines = (next: DraftLine[]) => {
    if (next.length > MAX_LINES) {
      setNotice(t('entry.tooMany'));
      return;
    }
    setNotice(null);
    setError(null);
    requestId.current = null;
    setLines(next);
    saveDraft(table.id, next);
  };

  const menu = menuState.status === 'ready' ? menuState.menu : null;
  const items = useMemo(() => (menu ? itemsById(menu) : new Map<number, MenuItem>()), [menu]);
  const tableLabel = `${t('table.label')} ${String(table.number)}`;

  const send = () => {
    requestId.current ??= newRequestId();
    setSending(true);
    setError(null);
    createStaffOrder({
      clientRequestId: requestId.current,
      tableId: table.id,
      lines: orderLines(lines),
    }).then(
      (order) => {
        setSending(false);
        requestId.current = null;
        saveDraft(table.id, []);
        onSent(order, shifts ? unstaffedStations(order, shifts) : []);
      },
      (err: unknown) => {
        setSending(false);
        setError(errorText(err, lines, items));
        // Un article devenu indisponible : la carte est relue pour le griser ou le masquer.
        if (err instanceof ApiError && err.code !== 'NETWORK') loadMenu();
      },
    );
  };

  if (menuState.status === 'loading') {
    return (
      <>
        <BackButton label={tableLabel} onClick={onBack} />
        <p className="body" role="status">
          {t('entry.loading')}
        </p>
      </>
    );
  }
  if (!menu) {
    return (
      <>
        <BackButton label={tableLabel} onClick={onBack} />
        <div className="notice" role="alert">
          <p className="body">{t('entry.loadError')}</p>
          <button type="button" className="button" onClick={loadMenu}>
            {t('session.retry')}
          </button>
        </div>
      </>
    );
  }

  if (view.kind === 'item') {
    const item = items.get(view.itemId);
    if (item) {
      return (
        <ItemScreen
          item={item}
          items={items}
          menu={menu}
          notice={notice}
          onBack={() => setView({ kind: 'menu' })}
          onAdd={(selection) => {
            const next = addSelection(lines, { item, ...selection });
            changeLines(next);
            if (next.length <= MAX_LINES) setView({ kind: 'menu' });
          }}
        />
      );
    }
  }

  if (view.kind === 'review') {
    const missing = shifts
      ? unstaffedStations(
          {
            lines: lines.map((line) => ({ station: items.get(line.menuItemId)?.station ?? 'bar' })),
          },
          shifts,
        )
      : [];
    return (
      <>
        <BackButton label={t('entry.backToMenu')} onClick={() => setView({ kind: 'menu' })} />
        <h1 className="title">
          {t('entry.reviewTitle')} {String(table.number)}
        </h1>
        {lines.length === 0 ? (
          <p className="body">{t('entry.empty')}</p>
        ) : (
          <article className="ticket ticket--receipt" aria-label={t('entry.title')}>
            <ul className="ticket__lines">
              {lines.map((line) => (
                <DraftLineRow
                  key={line.key}
                  line={line}
                  items={items}
                  disabled={sending}
                  onQuantity={(q) => changeLines(setQuantity(lines, line.key, q))}
                  onRemove={() => changeLines(removeLine(lines, line.key))}
                />
              ))}
            </ul>
            <p className="ticket__total">
              <span className="ticket__total-label">{t('table.total')}</span>
              {formatPrice(draftTotal(lines, items))}
            </p>
          </article>
        )}
        {missing.length > 0 && lines.length > 0 && (
          <div className="alert">
            <span className="alert__icon">
              <StateIcon state={missing[0] === 'kitchen' ? 'kitchen' : 'bar'} />
            </span>
            <p className="alert__text">{nobodyText(missing)}</p>
          </div>
        )}
        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}
        {lines.length > 0 && (
          <button type="button" className="button button--block" disabled={sending} onClick={send}>
            {sending ? t('entry.sending') : `${t('entry.send')} ${String(table.number)}`}
          </button>
        )}
        <button
          type="button"
          className="button button--secondary button--block"
          disabled={sending}
          onClick={() => setView({ kind: 'menu' })}
        >
          {t('entry.addMore')}
        </button>
      </>
    );
  }

  const categories = menu.categories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => isShown(item) && matches(item, query)),
    }))
    .filter((category) => category.items.length > 0);

  return (
    <>
      <BackButton label={tableLabel} onClick={onBack} />
      <header className="table-head">
        <h1 className="title">{tableLabel}</h1>
      </header>
      <p className="table-head__meta">{t('entry.title')}</p>

      <div className="field">
        <label className="field__label" htmlFor="entry-search">
          {t('entry.search')}
        </label>
        <input
          id="entry-search"
          className="field__input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={t('entry.searchHint')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {notice && (
        <p className="form__error" role="alert">
          {notice}
        </p>
      )}

      {categories.length === 0 && <p className="body">{t('entry.noMatch')}</p>}
      {categories.map((category) => (
        <section key={category.id} className="menu-section" aria-label={category.name.fr}>
          <h2 className="menu-section__title">{category.name.fr}</h2>
          <ul className="rows">
            {category.items.map((item) => (
              <MenuRow
                key={item.id}
                item={item}
                count={countOf(lines, item.id)}
                onOpen={() => setView({ kind: 'item', itemId: item.id })}
                onQuickAdd={() => changeLines(quickAdd(lines, item.id))}
              />
            ))}
          </ul>
        </section>
      ))}

      {lines.length > 0 && (
        <div className="draft-bar">
          <p className="draft-bar__text">
            {draftCount(lines)} {t(draftCount(lines) === 1 ? 'entry.itemOne' : 'entry.itemMany')}
            {' · '}
            {formatPrice(draftTotal(lines, items))}
          </p>
          <button type="button" className="button" onClick={() => setView({ kind: 'review' })}>
            {t('entry.review')}
          </button>
        </div>
      )}
    </>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="back" onClick={onClick}>
      ‹ {label}
    </button>
  );
}

// Une ligne de la carte : nom et prix (toucher ouvre la fiche), « + » pour 1 de plus d'un article
// simple. Une formule s'ouvre toujours : ses choix sont obligatoires. En rupture : grisée.
function MenuRow({
  item,
  count,
  onOpen,
  onQuickAdd,
}: {
  item: MenuItem;
  count: number;
  onOpen: () => void;
  onQuickAdd: () => void;
}) {
  const soldOut = item.unavailableReason === 'sold_out';
  const withChoices = item.choiceGroups.length > 0;
  const name = item.name.fr;
  return (
    <li className={soldOut ? 'menu-row menu-row--off' : 'menu-row'}>
      <button type="button" className="row menu-row__open" disabled={soldOut} onClick={onOpen}>
        <span className="row__text">
          <span className="menu-row__name">{name}</span>
          <span className="row__hint">
            {formatPrice(item.price)}
            {withChoices && !soldOut && ` · ${t('entry.chooseHint')}`}
          </span>
        </span>
        {soldOut && <span className="status-chip">{t('entry.soldOut')}</span>}
        {count > 0 && (
          <span className="menu-row__count" aria-label={`${String(count)} ${t('entry.inDraft')}`}>
            {count}
          </span>
        )}
      </button>
      {!soldOut && !withChoices && (
        <button
          type="button"
          className="icon-button menu-row__add"
          aria-label={`${t('entry.addOne')} ${name}`}
          onClick={onQuickAdd}
        >
          +
        </button>
      )}
    </li>
  );
}

// Fiche d'un article : choix obligatoires (un par groupe), extras suggérés (une ligne chacun),
// quantité 1–20 et note (jamais tapée en caisse : elle s'affiche sur l'écran bar / cuisine).
function ItemScreen({
  item,
  items,
  menu,
  notice,
  onBack,
  onAdd,
}: {
  item: MenuItem;
  items: Map<number, MenuItem>;
  menu: MenuResponse;
  notice: string | null;
  onBack: () => void;
  onAdd: (selection: {
    quantity: number;
    note: string;
    choices: DraftChoice[];
    extraIds: number[];
  }) => void;
}) {
  const noteId = useId();
  const [quantity, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [choices, setChoices] = useState<Partial<Record<string, number>>>({});
  const [checked, setChecked] = useState<number[]>([]);

  const groups = groupsOf(item, menu.choiceGroups);
  const orderable = (id: number) => items.get(id)?.available === true;
  // Un choix ou un extra qui passe en rupture pendant que la fiche est ouverte ne compte plus.
  const chosen = (key: string) => {
    const id = choices[key];
    return id !== undefined && orderable(id) ? id : undefined;
  };
  const extras = item.suggestedExtraIds.flatMap((id) => {
    const extra = items.get(id);
    return extra && isShown(extra) ? [extra] : [];
  });
  const extraIds = checked.filter(orderable);
  const missingChoice = groups.some((group) => chosen(group.key) === undefined);
  const soldOut = item.unavailableReason === 'sold_out';
  const total =
    item.price * quantity + extraIds.reduce((sum, id) => sum + (items.get(id)?.price ?? 0), 0);

  return (
    <>
      <BackButton label={t('entry.backToMenu')} onClick={onBack} />
      <header className="table-head">
        <h1 className="title">{item.name.fr}</h1>
        <p className="table-head__total">{formatPrice(item.price)}</p>
      </header>
      {item.description && <p className="table-head__meta">{item.description.fr}</p>}

      {groups.map((group) => (
        <fieldset key={group.key} className="options">
          <legend className="options__legend">{group.name.fr}</legend>
          {group.optionIds.flatMap((id) => {
            const option = items.get(id);
            if (!option || !isShown(option)) return [];
            const off = option.unavailableReason === 'sold_out';
            return [
              <label key={id} className={off ? 'option option--off' : 'option'}>
                <input
                  type="radio"
                  name={`choix-${group.key}`}
                  checked={chosen(group.key) === id}
                  disabled={off}
                  onChange={() => setChoices((c) => ({ ...c, [group.key]: id }))}
                />
                <span className="option__label">{option.name.fr}</span>
                {off && <span className="option__hint">{t('entry.soldOut')}</span>}
              </label>,
            ];
          })}
        </fieldset>
      ))}

      {extras.length > 0 && (
        <fieldset className="options">
          <legend className="options__legend">{t('entry.extras')}</legend>
          {extras.map((extra) => {
            const off = extra.unavailableReason === 'sold_out';
            return (
              <label key={extra.id} className={off ? 'option option--off' : 'option'}>
                <input
                  type="checkbox"
                  checked={extraIds.includes(extra.id)}
                  disabled={off}
                  onChange={() =>
                    setChecked((ids) =>
                      ids.includes(extra.id)
                        ? ids.filter((x) => x !== extra.id)
                        : [...ids, extra.id],
                    )
                  }
                />
                <span className="option__label">+{extra.name.fr}</span>
                <span className="option__hint">
                  {off ? t('entry.soldOut') : formatPrice(extra.price)}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      <div className="field">
        <span className="field__label" id={`${noteId}-qty`}>
          {t('entry.quantity')}
        </span>
        <Stepper
          labelledBy={`${noteId}-qty`}
          value={quantity}
          onChange={setQty}
          name={item.name.fr}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={noteId}>
          {t('entry.note')}
        </label>
        {item.noteHint && <p className="field__hint">{item.noteHint.fr}</p>}
        <textarea
          id={noteId}
          className="field__input field__input--multiline"
          rows={2}
          maxLength={MAX_NOTE_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <p className="field__hint">
          {t('entry.noteHelp')} {note.length}/{MAX_NOTE_LENGTH}
        </p>
      </div>

      {missingChoice && !soldOut && <p className="field__hint">{t('entry.chooseFirst')}</p>}
      {notice && (
        <p className="form__error" role="alert">
          {notice}
        </p>
      )}
      <button
        type="button"
        className="button button--block"
        disabled={soldOut || missingChoice}
        onClick={() =>
          onAdd({
            quantity,
            note,
            extraIds,
            choices: groups.flatMap((group) => {
              const menuItemId = chosen(group.key);
              return menuItemId === undefined ? [] : [{ group: group.key, menuItemId }];
            }),
          })
        }
      >
        {t('entry.add')} · {formatPrice(total)}
      </button>
    </>
  );
}

/** − quantité + : boutons de 48 px, bornés à 1–20. */
function Stepper({
  value,
  onChange,
  name,
  labelledBy,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  name: string;
  labelledBy?: string;
  disabled?: boolean;
}) {
  return (
    <div
      className="stepper"
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : name}
    >
      <button
        type="button"
        className="stepper__button"
        aria-label={`${t('entry.less')} : ${name}`}
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <output className="stepper__value" aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        className="stepper__button"
        aria-label={`${t('entry.more')} : ${name}`}
        disabled={disabled || value >= MAX_QUANTITY}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

// Une ligne du récapitulatif : comme sur la carte de commande, plus la quantité et « Retirer ».
function DraftLineRow({
  line,
  items,
  disabled,
  onQuantity,
  onRemove,
}: {
  line: DraftLine;
  items: Map<number, MenuItem>;
  disabled: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const item = items.get(line.menuItemId);
  const name = item?.name.fr ?? '';
  return (
    <li className="ticket__line draft-line">
      <span className="ticket__qty">{line.quantity} ×</span>
      <div className="ticket__what">
        <p className="ticket__name">{name}</p>
        {line.choices.length > 0 && (
          <p className="ticket__choices">
            {line.choices.map((c) => items.get(c.menuItemId)?.name.fr ?? '').join(' · ')}
          </p>
        )}
        {line.note && <p className="ticket__note">« {line.note} »</p>}
        <div className="draft-line__actions">
          <Stepper value={line.quantity} onChange={onQuantity} name={name} disabled={disabled} />
          <button type="button" className="link-button" disabled={disabled} onClick={onRemove}>
            {t('entry.remove')}
          </button>
        </div>
      </div>
      <span className="ticket__price">{formatPrice((item?.price ?? 0) * line.quantity)}</span>
    </li>
  );
}

// Message d'un envoi refusé : quoi faire, sans terme technique.
function errorText(err: unknown, lines: DraftLine[], items: Map<number, MenuItem>): string {
  if (!(err instanceof ApiError)) return t('entry.error.other');
  if (err.code === 'NETWORK') return t('entry.error.network');
  if (err.code === 'NOT_ON_SHIFT') return t('entry.error.notOnShift');
  if (err.code === 'ITEM_UNAVAILABLE' || err.code === 'OUTSIDE_HOURS') {
    const id = err.details['menuItemId'];
    const name =
      typeof id === 'number' && linesWithItem(lines, id).length > 0 ? items.get(id)?.name.fr : null;
    if (!name) return t('entry.error.unknownItem');
    return `« ${name} » ${t(err.code === 'ITEM_UNAVAILABLE' ? 'entry.error.soldOut' : 'entry.error.outsideHours')}`;
  }
  return t('entry.error.other');
}
