import { LanguageSwitch } from './LanguageSwitch';

// En-tête : nom du café et langue. Il défile avec la page ; seule la barre Food / Drinks et
// catégories reste fixe, pour laisser de la place à la carte sur un petit écran.
export function Header() {
  return (
    <header className="header">
      <div className="header__inner">
        {/* Nom du café : identique en FR et EN */}
        <p className="brand">
          Café{' '}
          <span className="brand__ar" lang="ar">
            زيتون
          </span>
        </p>
        <LanguageSwitch />
      </div>
    </header>
  );
}
