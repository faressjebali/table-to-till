import { LanguageSwitch } from './LanguageSwitch';

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
