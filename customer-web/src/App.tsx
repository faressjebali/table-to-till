import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, getMenu, getTable } from './api/client';
import type { MenuItem, MenuResponse, MenuSectionKey } from './api/types';
import type { CartLine } from './cart';
import { CartBar } from './components/CartBar';
import { CategoryNav } from './components/CategoryNav';
import { Header } from './components/Header';
import { ItemSheet } from './components/ItemSheet';
import { MenuSection } from './components/MenuSection';
import { SectionTabs } from './components/SectionTabs';
import { useLanguage } from './i18n/useLanguage';
import {
  availableSections,
  itemsById,
  sectionCategories,
  sectionPanelId,
  sectionTabId,
  visibleCategories,
} from './menu-view';
import { tableTokenFromPath } from './table-link';

type State =
  | { status: 'loading' }
  | { status: 'unknown-table' }
  | { status: 'error' }
  | { status: 'ready'; menu: MenuResponse };

// Le client arrive par le lien du QR de sa table (/t/<jeton>, docs/api.md § 3). Le jeton est
// vérifié, mais le numéro de la table n'est pas affiché : le client n'en a pas besoin.
export function App() {
  const { t } = useLanguage();
  const tableToken = tableTokenFromPath(window.location.pathname);
  const [state, setState] = useState<State>(
    tableToken ? { status: 'loading' } : { status: 'unknown-table' },
  );
  const [attempt, setAttempt] = useState(0);
  const [section, setSection] = useState<MenuSectionKey>('food');
  // Panier en mémoire (l'écran du panier et l'envoi viendront plus tard).
  const [cart, setCart] = useState<CartLine[]>([]);
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  const closeSheet = useCallback(() => setOpenItem(null), []);

  useEffect(() => {
    if (!tableToken) return;
    let ignore = false;
    Promise.all([getTable(tableToken), getMenu()])
      .then(([, menu]) => {
        if (!ignore) setState({ status: 'ready', menu });
      })
      .catch((err: unknown) => {
        if (ignore) return;
        const unknown = err instanceof ApiError && err.code === 'TABLE_NOT_FOUND';
        setState({ status: unknown ? 'unknown-table' : 'error' });
      });
    return () => {
      ignore = true;
    };
  }, [tableToken, attempt]);

  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  const menu = state.status === 'ready' ? state.menu : null;
  const categories = useMemo(() => (menu ? visibleCategories(menu) : []), [menu]);
  const items = useMemo(() => (menu ? itemsById(menu) : new Map()), [menu]);
  const sections = availableSections(categories);
  // Onglet choisi, ou le premier qui a des articles (ex. plus rien en Food).
  const activeSection = sections.includes(section) ? section : sections[0];
  const shown = activeSection ? sectionCategories(categories, activeSection) : [];

  const addToCart = (lines: CartLine[]) => {
    setCart((current) => [...current, ...lines]);
    setOpenItem(null);
  };

  const changeSection = (next: MenuSectionKey) => {
    setSection(next);
    // Haut de la carte du nouvel onglet, sous la barre fixe.
    document.getElementById(sectionPanelId)?.scrollIntoView?.({ block: 'start' });
  };

  return (
    <>
      {/* Pendant que la fiche est ouverte, le reste de la page est inerte (focus et lecteur d'écran) */}
      <div className="page" inert={openItem !== null}>
        <Header />
        {activeSection && (
          <div className="menu-bar">
            <SectionTabs sections={sections} active={activeSection} onChange={changeSection} />
            <CategoryNav categories={shown} />
          </div>
        )}
        <main className="main">
          {state.status === 'loading' && (
            <p className="status" role="status">
              {t('menu.loading')}
            </p>
          )}

          {state.status === 'unknown-table' && (
            <div className="notice">
              <h1 className="page-title">{t('table.unknown.title')}</h1>
              <p className="notice__body">{t('table.unknown.body')}</p>
            </div>
          )}

          {state.status === 'error' && (
            <div className="notice" role="alert">
              <h1 className="page-title">{t('error.title')}</h1>
              <p className="notice__body">{t('error.body')}</p>
              <button type="button" className="button" onClick={retry}>
                {t('error.retry')}
              </button>
            </div>
          )}

          {state.status === 'ready' && (
            <>
              <div className="welcome">
                <h1 className="page-title">{t('menu.title')}</h1>
                <p className="intro">{t('menu.intro')}</p>
                <p className="counter-hint">{t('menu.counterHint')}</p>
              </div>
              {activeSection && (
                <div
                  id={sectionPanelId}
                  className="section-panel"
                  role="tabpanel"
                  aria-labelledby={sectionTabId(activeSection)}
                >
                  {shown.map((category) => (
                    <MenuSection
                      key={category.id}
                      category={category}
                      items={items}
                      onOpen={setOpenItem}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
        {state.status === 'ready' && <CartBar lines={cart} items={items} />}
      </div>
      {menu && openItem && (
        <ItemSheet
          item={openItem}
          items={items}
          choiceGroups={menu.choiceGroups}
          onAdd={addToCart}
          onClose={closeSheet}
        />
      )}
    </>
  );
}
