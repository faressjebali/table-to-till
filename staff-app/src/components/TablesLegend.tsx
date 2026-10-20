import { t, type MessageKey } from '../i18n/fr';
import { TableTile, type TableTileProps } from './TableTile';

// Légende du plan (docs/design.md § 6) : les 7 états, chacun avec la même carte de table que sur
// le plan et son nom. L'échec caisse y figure déjà, avant d'être branché sur le plan.
const STATES: { name: MessageKey; tile: Omit<TableTileProps, 'label'> }[] = [
  { name: 'legend.free', tile: { number: 1 } },
  { name: 'legend.occupied', tile: { number: 2, amount: '38' } },
  { name: 'legend.pending', tile: { number: 3, pending: 1 } },
  { name: 'legend.failed', tile: { number: 4, amount: '41,5', failed: true } },
  { name: 'legend.bar', tile: { number: 5, amount: '24,5', ready: ['bar'] } },
  { name: 'legend.kitchen', tile: { number: 6, amount: '18', ready: ['kitchen'] } },
  { name: 'legend.other', tile: { number: 7, amount: '27', other: true } },
];

export function TablesLegend({ onClose }: { onClose: () => void }) {
  return (
    <section className="legend" aria-labelledby="tables-legend-title">
      <div className="legend__head">
        <h2 id="tables-legend-title" className="legend__title">
          {t('tables.legend')}
        </h2>
        <button type="button" className="button button--secondary" onClick={onClose}>
          {t('tables.legendClose')}
        </button>
      </div>
      <ul className="legend__items">
        {STATES.map(({ name, tile }) => (
          <li key={name} className="legend__item">
            <TableTile {...tile} label={t(name)} decorative />
            <span>{t(name)}</span>
          </li>
        ))}
      </ul>
      <p className="field__hint">{t('tables.legendAmounts')}</p>
    </section>
  );
}
