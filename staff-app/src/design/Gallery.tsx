import type { ReactNode } from 'react';
import type { Room, Table } from '../api/types';
import { StateIcon } from '../components/StateIcon';
import { TabIcon } from '../components/TabIcon';
import { TableTile, type TableTileProps } from '../components/TableTile';
import { RoomSwitch } from '../components/RoomSwitch';
import { TablesLegend } from '../components/TablesLegend';
import { ThemeChoice } from '../components/ThemeChoice';
import { drawRoom } from '../tablePlan';

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

type Tile = Omit<TableTileProps, 'label'>;
type Sample = Tile & { room: Room; x: number; y: number; w?: number };

// Les deux salles de docs/tables.csv, avec des tables dans chaque état (données d'exemple).
const SAMPLES: Sample[] = [
  { number: 17, room: 'inside', x: 2, y: 0, round: true, amount: '22', pending: 1 },
  { number: 18, room: 'inside', x: 3, y: 0, amount: '12,5' },
  { number: 7, room: 'inside', x: 2, y: 1, pending: 1 },
  { number: 27, room: 'inside', x: 4, y: 1, amount: '9' },
  { number: 14, room: 'inside', x: 5, y: 1, amount: '41,5', failed: true },
  { number: 25, room: 'inside', x: 0, y: 2, round: true, amount: '30', ready: ['bar'] },
  { number: 6, room: 'inside', x: 2, y: 2, amount: '31', pending: 2 },
  { number: 26, room: 'inside', x: 4, y: 2, amount: '18', ready: ['kitchen'] },
  { number: 8, room: 'inside', x: 1, y: 3 },
  { number: 5, room: 'inside', x: 4, y: 3, round: true, amount: '27', other: true },
  { number: 12, room: 'inside', x: 5, y: 3 },
  { number: 4, room: 'inside', x: 4, y: 4 },
  { number: 1, room: 'inside', x: 0, y: 5 },
  { number: 3, room: 'inside', x: 4, y: 5, amount: '16', ready: ['bar', 'kitchen'] },
  { number: 11, room: 'inside', x: 5, y: 5 },
  { number: 2, room: 'inside', x: 4, y: 6 },
  { number: 10, room: 'inside', x: 5, y: 7 },
  { number: 9, room: 'inside', x: 5, y: 8 },
  { number: 20, room: 'terrace', x: 1, y: 0, amount: '38' },
  { number: 21, room: 'terrace', x: 2, y: 0 },
  { number: 19, room: 'terrace', x: 3, y: 0, w: 2, amount: '64', pending: 1, ready: ['bar'] },
  { number: 100, room: 'terrace', x: 0, y: 1, amount: '125,5' },
  { number: 22, room: 'terrace', x: 1, y: 1, pending: 2 },
  { number: 23, room: 'terrace', x: 2, y: 1, amount: '24,5', other: true },
];

// Une Table du contrat pour chaque exemple, pour dessiner la salle comme l'écran Tables.
const asTable = (sample: Sample): Table => ({
  id: sample.number,
  number: sample.number,
  kind: 'real',
  state: sample.amount === undefined ? 'free' : 'occupied',
  openSessionId: null,
  openTotal: 0,
  pendingOrders: sample.pending ?? 0,
  layout: {
    room: sample.room,
    x: sample.x,
    y: sample.y,
    w: sample.w ?? 1,
    h: 1,
    shape: sample.round ? 'round' : 'square',
  },
  offer: null,
  principalId: null,
});

function GalleryRoom({ room }: { room: Room }) {
  const samples = SAMPLES.filter((sample) => sample.room === room);
  const plan = drawRoom(samples.map(asTable));
  return (
    <div
      className="room"
      role="group"
      aria-label={`Plan : ${room}`}
      style={{ width: plan.width, height: plan.height }}
    >
      {plan.tables.map(({ table, left, top, width, height, round, long }) => {
        const sample = samples.find((s) => s.number === table.number);
        if (!sample) return null;
        // Les champs de place (salle, case) ne gênent pas : TableTile ne lit que les siens.
        return (
          <div key={table.number} className="room__cell" style={{ left, top, width, height }}>
            <TableTile {...sample} round={round} long={long} label={describe(sample)} />
          </div>
        );
      })}
    </div>
  );
}

const STATES: { title: string; tile: Omit<TableTileProps, 'label'> }[] = [
  { title: 'Libre', tile: { number: 21 } },
  { title: 'Occupée', tile: { number: 20, amount: '38' } },
  { title: 'À confirmer', tile: { number: 7, pending: 1 } },
  { title: 'Échec caisse', tile: { number: 14, amount: '41,5', failed: true } },
  { title: 'Prête au bar', tile: { number: 23, amount: '24,5', ready: ['bar'] } },
  { title: 'Prête en cuisine', tile: { number: 26, amount: '18', ready: ['kitchen'] } },
  { title: 'Autre principal', tile: { number: 5, amount: '27', other: true } },
  { title: 'Bar et cuisine prêts', tile: { number: 3, amount: '16', ready: ['bar', 'kitchen'] } },
  { title: 'Prête et à confirmer', tile: { number: 6, amount: '31', pending: 2, ready: ['bar'] } },
  { title: 'Ronde, 3 chiffres', tile: { number: 100, amount: '125,5', round: true } },
  { title: 'Ronde à confirmer', tile: { number: 17, pending: 1, round: true } },
  { title: 'Ronde, échec caisse', tile: { number: 25, amount: '30', failed: true, round: true } },
  {
    title: 'Ronde prête',
    tile: { number: 5, amount: '27', ready: ['bar', 'kitchen'], round: true },
  },
  { title: 'Ronde, autre principal', tile: { number: 17, amount: '22', other: true, round: true } },
];

// La table longue (la 19 de la terrasse) prend toute une ligne de la galerie.
const LONG: { title: string; tile: Tile }[] = [
  { title: 'Longue, libre', tile: { number: 19, long: true } },
  {
    title: 'Longue, à confirmer et prête',
    tile: { number: 19, amount: '64', pending: 1, ready: ['bar'], long: true },
  },
  { title: 'Longue, échec caisse', tile: { number: 19, amount: '64', failed: true, long: true } },
  { title: 'Longue, autre principal', tile: { number: 19, amount: '64', other: true, long: true } },
];

function describe(tile: Omit<TableTileProps, 'label'>): string {
  const parts = [`Table ${String(tile.number)}`];
  parts.push(tile.amount === undefined ? 'libre' : `occupée, ${tile.amount} DT`);
  if (tile.failed) parts.push('échec caisse');
  if (tile.pending) parts.push(`${String(tile.pending)} à confirmer`);
  if (tile.ready?.includes('bar')) parts.push('boissons prêtes');
  if (tile.ready?.includes('kitchen')) parts.push('plats prêts');
  if (tile.other) parts.push('caisse de Sami');
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

        <Section title="Plan : intérieur (360 px)">
          <RoomSwitch
            room="inside"
            counts={{ inside: 18, terrace: 6 }}
            waiting={{ inside: 5, terrace: 3 }}
            onChange={() => undefined}
          />
          <GalleryRoom room="inside" />
        </Section>

        <Section title="Plan : terrasse (360 px)">
          <RoomSwitch
            room="terrace"
            counts={{ inside: 18, terrace: 6 }}
            waiting={{ inside: 5, terrace: 3 }}
            onChange={() => undefined}
          />
          <GalleryRoom room="terrace" />
        </Section>

        <Section title="Résumé du plan et légende">
          <ul className="chips" aria-label="Résumé du plan">
            <li>
              <button type="button" className="chip" aria-pressed="false">
                <span className="chip__swatch chip__swatch--occupied" aria-hidden="true" />8
                occupées
              </button>
            </li>
            <li>
              <button type="button" className="chip" aria-pressed="true">
                <span className="chip__swatch chip__swatch--pending" aria-hidden="true" />1 à
                confirmer
              </button>
            </li>
            <li>
              <button type="button" className="chip" aria-pressed="false">
                <span className="chip__icon chip__icon--ready" aria-hidden="true">
                  <StateIcon state="bar" size={14} />
                </span>
                2 prêtes
              </button>
            </li>
            <li>
              <button type="button" className="chip" aria-pressed="false">
                <span className="chip__icon chip__icon--other" aria-hidden="true">
                  <StateIcon state="person" size={14} />
                </span>
                Sami : 2 tables
              </button>
            </li>
            <li>
              <button
                type="button"
                className="icon-button"
                aria-label="Légende"
                aria-expanded="true"
              >
                ?
              </button>
            </li>
          </ul>
          <TablesLegend onClose={() => undefined} />
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
          <ul className="gallery__states gallery__states--long">
            {LONG.map(({ title, tile }) => (
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
              <span className="status-chip status-chip--danger">
                <StateIcon state="failed" size={16} />
                Échec caisse
              </span>
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

        <Section title="Commande à confirmer">
          <article className="ticket ticket--receipt">
            <header className="ticket__head">
              <h2 className="ticket__place">Table 7</h2>
              <time className="ticket__time">09:04</time>
            </header>
            <ul className="ticket__lines">
              <li className="ticket__line">
                <span className="ticket__qty">1 ×</span>
                <div className="ticket__what">
                  <p className="ticket__name">Cheese Burger</p>
                  <p className="ticket__note">« sans oignon »</p>
                </div>
                <span className="ticket__price">26 DT</span>
              </li>
            </ul>
            <p className="ticket__total">
              <span className="ticket__total-label">Total</span>26 DT
            </p>
            <div className="alert">
              <span className="alert__icon">
                <StateIcon state="kitchen" />
              </span>
              <p className="alert__text">Personne en cuisine : prévenez à l’oral.</p>
            </div>
            <button type="button" className="button button--block">
              Confirmer
            </button>
            <button type="button" className="button button--secondary button--block">
              Rejeter
            </button>
          </article>
          <div className="confirm" role="group" aria-label="Rejeter">
            <p className="confirm__text">
              Rejeter cette commande ? Le client verra qu’elle est refusée.
            </p>
            <button type="button" className="button button--danger">
              Oui, rejeter la commande
            </button>
            <button type="button" className="button button--secondary">
              Annuler
            </button>
          </div>
        </Section>

        <Section title="Onglet Commandes avec commandes à confirmer">
          <nav className="tabbar gallery__tabbar" aria-label="Écrans">
            <button type="button" className="tabbar__tab">
              <TabIcon destination="tables" />
              <span className="tabbar__label">Tables</span>
            </button>
            <button type="button" className="tabbar__tab" aria-current="page">
              <span className="tabbar__icon">
                <TabIcon destination="orders" />
                <span className="tabbar__badge" aria-hidden="true">
                  2
                </span>
              </span>
              <span className="tabbar__label">Commandes</span>
              <span className="visually-hidden">, 2 à confirmer</span>
            </button>
            <button type="button" className="tabbar__tab">
              <span className="tabbar__icon">
                <TabIcon destination="orders" />
                <span className="tabbar__badge" aria-hidden="true">
                  99+
                </span>
              </span>
              <span className="tabbar__label">Commandes</span>
            </button>
          </nav>
        </Section>

        <Section title="Comptes">
          <ul className="rows">
            <li>
              <button type="button" className="row">
                <span className="row__text">
                  <span className="row__label">Amira</span>
                  <span className="row__hint">Serveur</span>
                  <span className="row__chips">
                    <span className="status-chip">Mot de passe à changer</span>
                  </span>
                </span>
                <span className="row__chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
            <li>
              <button type="button" className="row">
                <span className="row__text">
                  <span className="row__label">Rania (vous)</span>
                  <span className="row__hint">Manager · Patronne</span>
                </span>
                <span className="row__chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
            <li>
              <button type="button" className="row">
                <span className="row__text">
                  <span className="row__label">Sami</span>
                  <span className="row__hint">Barista</span>
                  <span className="row__chips">
                    <span className="status-chip status-chip--danger">Désactivé</span>
                    <span className="status-chip status-chip--danger">Bloqué</span>
                  </span>
                </span>
                <span className="row__chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          </ul>
          <div className="secret">
            <p className="secret__label">Mot de passe temporaire</p>
            <p className="secret__value">k7xm2qp9ad</p>
          </div>
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
