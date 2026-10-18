import { MAX_QUANTITY } from '../cart';
import { useLanguage } from '../i18n/useLanguage';

// Quantité de 1 à 20 (docs/product.md § 4), avec deux boutons de 44 px.
export function QuantityStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="stepper" role="group" aria-label={t('sheet.quantity')}>
      <button
        type="button"
        className="stepper__button"
        aria-label={t('sheet.decrease')}
        disabled={value <= 1}
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
        aria-label={t('sheet.increase')}
        disabled={value >= MAX_QUANTITY}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}
