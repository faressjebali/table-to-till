import type { ReactNode } from 'react';
import { LanguageSwitch } from './LanguageSwitch';

// En-tête fixe ; `children` : la barre des catégories, collée sous le nom du café.
export function Header({ children }: { children?: ReactNode }) {
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
      {children}
    </header>
  );
}
