import { useRef, type KeyboardEvent } from 'react';
import type { MenuSectionKey } from '../api/types';
import { useLanguage } from '../i18n/useLanguage';
import { sectionPanelId, sectionTabId } from '../menu-view';

// Onglets Food / Drinks en haut de la carte : un client qui veut un café n'a pas à descendre
// jusqu'en bas. Flèches gauche / droite pour passer d'un onglet à l'autre (motif ARIA « tabs »).
export function SectionTabs({
  sections,
  active,
  onChange,
}: {
  sections: MenuSectionKey[];
  active: MenuSectionKey;
  onChange: (section: MenuSectionKey) => void;
}) {
  const { t } = useLanguage();
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = sections.indexOf(active);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = sections[(index + step + sections.length) % sections.length];
    if (!next) return;
    onChange(next);
    listRef.current?.querySelector<HTMLElement>(`#${sectionTabId(next)}`)?.focus();
  };

  return (
    <div
      ref={listRef}
      className="section-tabs"
      role="tablist"
      aria-label={t('menu.sections')}
      onKeyDown={onKeyDown}
    >
      {sections.map((section) => (
        <button
          key={section}
          id={sectionTabId(section)}
          type="button"
          role="tab"
          className="section-tabs__tab"
          aria-selected={section === active}
          aria-controls={sectionPanelId}
          tabIndex={section === active ? 0 : -1}
          onClick={() => onChange(section)}
        >
          {t(`menu.section.${section}`)}
        </button>
      ))}
    </div>
  );
}
