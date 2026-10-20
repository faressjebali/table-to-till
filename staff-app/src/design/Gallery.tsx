import type { CSSProperties, ReactNode } from 'react';
import { StateIcon } from '../components/StateIcon';
import { TableTile, type TableTileProps } from '../components/TableTile';
import { ThemeChoice } from '../components/ThemeChoice';

// Galerie du système de design (docs/design.md) : chaque composant dans chacun de ses états, pour
// les captures et pour vérifier sur téléphone, dans les deux thèmes. Données d'exemple seulement.

const COLORS = [
  ['--color-paper', 'Fond de l’app'],
  ['--color-surface', 'Cartes, barre d’onglets'],
  ['--color-ink', 'Texte'],
  ['--color-muted', 'Texte secondaire, contour d’une table libre'],
  ['--color-border', 'Traits de séparation (décor seulement)'],
  ['--color-action', 'Bouton principal, table occupée'],
  ['--color-accent', 'Liens, onglet ouvert, commande à confirmer'],
  ['--color-danger', 'Bouton danger, échec caisse'],
  ['--color-ready', 'Prête au bar, prête en cuisine'],
] as const;

type Sample = Omit<TableTileProps, 'label'> & { column: number; row: number };

// La salle (docs/tables.csv) sur 6 colonnes : x 7-8 et x 10-12 ne se chevauchent jamais.
const ROOM: Sample[] = [
  { number: 21, column: 1, row: 1 },
  { number: 20, column: 2, row: 1, amount: '38' },
  { number: 19, column: 3, row: 1 },
  { number: 17, column: 4, row: 1 },
  { number: 18, column: 5, row: 1, amount: '12,5' },
  { number: 23, column: 1, row: 2, amount: '24,5', ready: ['bar'] },
  { number: 22, column: 2, row: 2 },
  { number: 7, column: 4, row: 2, pending: 1 },
  { number: 27, column: 5, row: 2, amount: '9' },
  { number: 14, column: 6, row: 2, amount: '41,5', failed: true },
  { number: 8, column: 3, row: 3 },
  { number: 6, column: 4, row: 3, amount: '31', pending: 2 },
  { number: 26, column: 5, row: 3, amount: '18', ready: ['kitchen'] },
  { number: 25, column: 1, row: 4 },
  { number: 5, column: 5, row: 4, amount: '27', owner: 'AB' },
  { number: 12, column: 6, row: 4 },
  { number: 1, column: 2, row: 5 },
  { number: 4, column: 5, row: 5 },
  { number: 3, column: 5, row: 6, amount: '16', ready: ['bar', 'kitchen'] },
  { number: 11, column: 6, row: 6 },
  { number: 100, column: 2, row: 7, amount: '125,5' },
  { number: 2, column: 5, row: 7 },
  { number: 10, column: 6, row: 8 },
  { number: 9, column: 6, row: 9 },
];

const STATES: { title: string; tile: Omit<TableTileProps, 'label'> }[] = [
  { title: 'Libre', tile: { number: 21 } },
  { title: 'Occupée', tile: { number: 20, amount: '38' } },
  { title: 'À confirmer', tile: { number: 7, pending: 1 } },
  { title: 'Échec caisse', tile: { number: 14, amount: '41,5', failed: true } },
  { title: 'Prête au bar', tile: { number: 23, amount: '24,5', ready: ['bar'] } },
  { title: 'Prête en cuisine', tile: { number: 26, amount: '18', ready: ['kitchen'] } },
  { title: 'Autre principal', tile: { number: 5, amount: '27', owner: 'AB' } },
  { title: 'Bar et cuisine prêts', tile: { number: 3, amount: '16', ready: ['bar', 'kitchen'] } },
  { title: 'Prête et à confirmer', tile: { number: 6, amount: '31', pending: 2, ready: ['bar'] } },
  { title: 'Ronde, 3 chiffres', tile: { number: 100, amount: '125,5', round: true } },
];

function describe(tile: Omit<TableTileProps, 'label'>): string {
  const parts = [`Table ${String(tile.number)}`];
  parts.push(tile.amount === undefined ? 'libre' : `occupée, ${tile.amount} DT`);
  if (tile.failed) parts.push('échec caisse');
  if (tile.pending) parts.push(`${String(tile.pending)} à confirmer`);
  if (tile.ready?.includes('bar')) parts.push('boissons prêtes');
  if (tile.ready?.includes('kitchen')) parts.push('plats prêts');
  if (tile.owner) parts.push(`caisse de ${tile.owner}`);
  return parts.join(', ');
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gallery__section">
      <h2 className="gallery__heading">{title}</h2>
      {children}
    </section>
  );
}

export function Gallery() {
  return (
    <>
      <div className="banner banner--offline" role="status">
        <StateIcon state="offline" />
        <p className="banner__text">Pas de connexion. Actions bloquées.</p>
      </div>
      <div className="banner banner--update" role="status">
        <StateIcon state="update" />
        <p className="banner__text">Nouvelle version disponible</p>
        <button type="button" className="button">
          Recharger
        </button>
      </div>

      <main className="main">
        <h1 className="title">Galerie de design</h1>
        <p className="body">
          Référence : docs/design.md. À vérifier dans les deux thèmes, sur un téléphone de 360 px.
        </p>
        <ThemeChoice />

        <Section title="Plan des tables (360 px)">
          <div
            className="room"
            style={{ '--room-columns': 6, '--room-rows': 9 } as CSSProperties}
            role="group"
            aria-label="Plan de la salle"
          >
            {ROOM.map(({ column, row, ...tile }) => (
              <div key={tile.number} style={{ gridColumn: column, gridRow: row }}>
                <TableTile {...tile} label={describe(tile)} />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Carte de table">
          <ul className="gallery__states">
            {STATES.map(({ title, tile }) => (
              <li key={title} className="gallery__state">
                <TableTile {...tile} label={describe(tile)} />
                <span className="gallery__caption">{title}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Boutons">
          <button type="button" className="button button--block">
            Confirmer
          </button>
          <button type="button" className="button button--secondary button--block">
            Imprimer l’addition
          </button>
          <button type="button" className="button button--danger button--block">
            Rejeter la commande
          </button>
          <button type="button" className="button button--block" disabled>
            Confirmer (pas de connexion)
          </button>
        </Section>

        <Section title="Carte de commande">
          <article className="ticket ticket--receipt">
            <header className="ticket__head">
              <h2 className="ticket__place">Table 7</h2>
              <span className="ticket__time">10:42</span>
            </header>
            <ul className="ticket__lines">
              <li className="ticket__line">
                <span className="ticket__qty">2×</span>
                <span className="ticket__what">
                  <span className="ticket__name">Capuccino</span>
                  <span className="ticket__note">sans sucre</span>
                </span>
              </li>
              <li className="ticket__line">
                <span className="ticket__qty">1×</span>
                <span className="ticket__what">
                  <span className="ticket__name">Formule tunisienne</span>
                  <span className="ticket__choices">Café crème, jus de grenade</span>
                </span>
              </li>
              <li className="ticket__line ticket__line--off">
                <span className="ticket__qty">1×</span>
                <span className="ticket__what">
                  <span className="ticket__name">
                    <s>Espresso premium</s>
                  </span>
                </span>
                <span className="ticket__flag">ANNULÉ</span>
              </li>
            </ul>
            <button type="button" className="button button--block">
              Prêt
            </button>
          </article>
        </Section>

        <Section title="Bandeaux d’alerte">
          <div className="alert alert--danger" role="alert">
            <span className="alert__icon">
              <StateIcon state="failed" />
            </span>
            <p className="alert__text">Échec caisse, table 14</p>
            <button type="button" className="button button--secondary">
              Réessayer
            </button>
          </div>
          <div className="alert" role="status">
            <span className="alert__icon">
              <StateIcon state="bar" />
            </span>
            <p className="alert__text">Personne au bar : prévenez à l’oral.</p>
          </div>
          <div className="ready">
            <span className="alert__icon">
              <StateIcon state="kitchen" />
            </span>
            <p className="ready__text">Table 26 : plats prêts</p>
            <button type="button" className="button button--secondary">
              OK
            </button>
          </div>
        </Section>

        <Section title="Couleurs">
          <ul className="gallery__colors">
            {COLORS.map(([name, role]) => (
              <li key={name} className="gallery__color">
                <span
                  className="gallery__swatch"
                  style={{ background: `var(${name})` }}
                  aria-hidden="true"
                />
                <span>
                  <code>{name}</code>
                  <br />
                  <span className="gallery__caption">{role}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Texte">
          <p className="title">Titre 28 : Tables</p>
          <p className="ticket__place">Titre 22 : Table 7</p>
          <p>Texte 17 : Commande envoyée en caisse.</p>
          <p>
            <strong>Texte 17 gras : 12,5 DT</strong>
          </p>
          <p className="field__hint">Texte 14 : Note ou précision.</p>
        </Section>
      </main>
    </>
  );
}
