import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import type { ChoiceGroup, MenuItem } from '../api/types';
import { MAX_NOTE_LENGTH, linesFromSelection, type CartLine } from '../cart';
import { formatPrice } from '../format';
import { useLanguage } from '../i18n/useLanguage';
import { suggestedExtras } from '../menu-view';
import { ChoiceGroupPicker } from './ChoiceGroupPicker';
import { QuantityStepper } from './QuantityStepper';

// Fiche d'un article (docs/product.md § 4) : photo, description, choix de formule, extras suggérés
// (un tap ; chacun devient une ligne séparée de quantité 1), quantité 1–20, note. Panneau qui monte
// du bas ; Échap ou ✕ ferme ; le reste de la page est inerte pendant qu'elle est ouverte.
export function ItemSheet({
  item,
  items,
  choiceGroups,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  items: Map<number, MenuItem>;
  choiceGroups: ChoiceGroup[];
  onAdd: (lines: CartLine[]) => void;
  onClose: () => void;
}) {
  const { lang, t } = useLanguage();
  const titleId = useId();
  const noteId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [choices, setChoices] = useState<Partial<Record<string, number>>>({});
  const [extraIds, setExtraIds] = useState<number[]>([]);

  const groups = item.choiceGroups.flatMap((key) => {
    const group = choiceGroups.find((g) => g.key === key);
    return group ? [group] : [];
  });
  const extras = suggestedExtras(item, items);
  const soldOut = item.unavailableReason === 'sold_out';
  const missingChoice = groups.some((group) => choices[group.key] === undefined);

  const selection = () => ({
    item,
    quantity,
    note,
    choices: groups.flatMap((group) => {
      const menuItemId = choices[group.key];
      return menuItemId === undefined ? [] : [{ group: group.key, menuItemId }];
    }),
    extraIds,
  });
  // Total indicatif : l'article × quantité, plus 1 de chaque extra coché.
  const total =
    item.price * quantity + extraIds.reduce((sum, id) => sum + (items.get(id)?.price ?? 0), 0);

  // Focus dans la fiche à l'ouverture, rendu à l'article à la fermeture ; Échap ferme.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  // Glisser la poignée vers le bas ferme la fiche (comme une feuille iOS) ; sinon elle revient.
  const [drag, setDrag] = useState<{ startY: number; dy: number } | null>(null);
  const onGrabberDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ startY: event.clientY, dy: 0 });
  };
  const onGrabberMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag) setDrag({ ...drag, dy: Math.max(0, event.clientY - drag.startY) });
  };
  const onGrabberUp = () => {
    if (drag && drag.dy > 100) onClose();
    setDrag(null);
  };

  const toggleExtra = (id: number) =>
    setExtraIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={
          drag ? { transform: `translateY(${String(drag.dy)}px)`, transition: 'none' } : undefined
        }
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="sheet__grabber"
          aria-hidden="true"
          onPointerDown={onGrabberDown}
          onPointerMove={onGrabberMove}
          onPointerUp={onGrabberUp}
          onPointerCancel={() => setDrag(null)}
        />
        <div className="sheet__scroll">
          <button
            ref={closeRef}
            type="button"
            className="sheet__close"
            aria-label={t('sheet.close')}
            onClick={onClose}
          >
            ✕
          </button>
          {item.photoUrl && (
            <img className="sheet__photo" src={item.photoUrl} alt="" width={800} height={600} />
          )}
          <h2 className="sheet__title" id={titleId}>
            {item.name[lang]}
          </h2>
          {item.description && <p className="sheet__description">{item.description[lang]}</p>}
          <p className="item__price">
            {formatPrice(item.price, lang)}
            {soldOut && <span className="item__badge">{t('menu.soldOut')}</span>}
          </p>

          {groups.map((group) => (
            <ChoiceGroupPicker
              key={group.key}
              group={group}
              items={items}
              selected={choices[group.key]}
              onSelect={(id) => setChoices((current) => ({ ...current, [group.key]: id }))}
            />
          ))}

          {extras.length > 0 && (
            <fieldset className="sheet__group">
              <legend className="sheet__label">{t('sheet.extras')}</legend>
              <div className="options">
                {extras.map((extra) => {
                  const extraSoldOut = extra.unavailableReason === 'sold_out';
                  return (
                    <label
                      key={extra.id}
                      className={extraSoldOut ? 'option option--disabled' : 'option'}
                    >
                      <input
                        type="checkbox"
                        checked={extraIds.includes(extra.id)}
                        disabled={extraSoldOut}
                        onChange={() => toggleExtra(extra.id)}
                      />
                      <span>+{extra.name[lang]}</span>
                      <span className="option__note">
                        {extraSoldOut ? t('menu.soldOut') : formatPrice(extra.price, lang)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div className="sheet__group">
            <label className="sheet__label" htmlFor={noteId}>
              {t('sheet.note')}
            </label>
            {item.noteHint && <p className="sheet__hint">{item.noteHint[lang]}</p>}
            <textarea
              id={noteId}
              className="sheet__note"
              rows={2}
              maxLength={MAX_NOTE_LENGTH}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <p className="sheet__count" aria-hidden="true">
              {note.length}/{MAX_NOTE_LENGTH}
            </p>
          </div>
        </div>

        <div className="sheet__footer">
          {missingChoice && !soldOut && <p className="sheet__missing">{t('sheet.chooseFirst')}</p>}
          <QuantityStepper value={quantity} onChange={setQuantity} />
          <button
            type="button"
            className="button sheet__add"
            disabled={soldOut || missingChoice}
            onClick={() => onAdd(linesFromSelection(selection()))}
          >
            {t('sheet.add')} · {formatPrice(total, lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
