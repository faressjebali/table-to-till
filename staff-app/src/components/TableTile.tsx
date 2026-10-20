import { StateIcon } from './StateIcon';

// Carte de table du plan (docs/design.md) : numéro, montant si occupée, pastille pour ce qui attend
// une action, bande bleue quand c'est prêt au bar ou en cuisine (une seule bande pour les deux). Chaque état a une forme ou une icône en plus de sa couleur.
export interface TableTileProps {
  number: number;
  /** Montant en cours, déjà mis en forme sans « DT » (« 12,5 ») ; absent si la table est libre. */
  amount?: string;
  /** Commandes à confirmer. */
  pending?: number;
  failed?: boolean;
  ready?: ('bar' | 'kitchen')[];
  /** Passation : la table est dans la caisse de l'autre principal (son nom est dans `label`). */
  other?: boolean;
  round?: boolean;
  /** Table longue (plusieurs cases, ex. la 19 de la terrasse). */
  long?: boolean;
  /** Ce que dit le lecteur d'écran : numéro, état, montant complet (« 12,5 DT »), ce qui attend. */
  label: string;
  onClick?: () => void;
  /** Exemple (légende) : rien à toucher ni à annoncer, le nom est écrit à côté. */
  decorative?: boolean;
}

export function TableTile({
  number,
  amount,
  pending = 0,
  failed = false,
  ready = [],
  other = false,
  round = false,
  long = false,
  label,
  onClick,
  decorative = false,
}: TableTileProps) {
  const classes = [
    'table-tile',
    round && 'table-tile--round',
    long && 'table-tile--long',
    amount !== undefined && (other ? 'table-tile--other' : 'table-tile--occupied'),
    pending > 0 && !failed && 'table-tile--pending',
    failed && 'table-tile--failed',
    ready.length > 0 && 'table-tile--ready',
  ];
  const className = classes.filter(Boolean).join(' ');
  const content = (
    <>
      {other && (
        <span className="table-tile__other" aria-hidden="true">
          <StateIcon state="person" size={14} />
        </span>
      )}
      <span className="table-tile__number" aria-hidden="true">
        {number}
      </span>
      {amount !== undefined && (
        <span className="table-tile__amount" aria-hidden="true">
          {amount}
        </span>
      )}
      {failed ? (
        <span className="table-tile__badge table-tile__badge--failed" aria-hidden="true">
          <StateIcon state="failed" size={12} />
        </span>
      ) : (
        pending > 0 && (
          <span className="table-tile__badge" aria-hidden="true">
            {pending}
          </span>
        )
      )}
      {ready.length > 0 && (
        <span className="table-tile__ready" aria-hidden="true">
          {ready.map((station) => (
            <StateIcon key={station} state={station} size={16} />
          ))}
        </span>
      )}
    </>
  );
  if (decorative) {
    return (
      <span className={className} aria-hidden="true">
        {content}
      </span>
    );
  }
  return (
    <button type="button" className={className} aria-label={label} onClick={onClick}>
      {content}
    </button>
  );
}
