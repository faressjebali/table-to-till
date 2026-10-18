import type { ChoiceGroup, MenuItem } from '../api/types';
import { useLanguage } from '../i18n/useLanguage';

// Un groupe de choix d'une formule ou du Kids Menu : exactement une option (docs/api.md § ChoiceGroup).
// Le prix d'une option n'est pas affiché : il est inclus dans la formule. Une option hors horaire
// est masquée ; en rupture, elle est grisée et ne peut pas être choisie.
export function ChoiceGroupPicker({
  group,
  items,
  selected,
  onSelect,
}: {
  group: ChoiceGroup;
  items: Map<number, MenuItem>;
  selected: number | undefined;
  onSelect: (menuItemId: number) => void;
}) {
  const { lang, t } = useLanguage();
  const options = group.optionIds.flatMap((id) => {
    const option = items.get(id);
    return option && option.unavailableReason !== 'outside_hours' ? [option] : [];
  });

  return (
    <fieldset className="sheet__group">
      <legend className="sheet__label">{group.name[lang]}</legend>
      <div className="options">
        {options.map((option) => {
          const soldOut = option.unavailableReason === 'sold_out';
          return (
            <label key={option.id} className={soldOut ? 'option option--disabled' : 'option'}>
              <input
                type="radio"
                name={`choix-${group.key}`}
                value={option.id}
                checked={selected === option.id}
                disabled={soldOut}
                onChange={() => onSelect(option.id)}
              />
              <span>{option.name[lang]}</span>
              {soldOut && <span className="option__note">{t('menu.soldOut')}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
