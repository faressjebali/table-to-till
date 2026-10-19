import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, getMenu, getTable } from './api/client';
import type { MenuItem, MenuResponse, MenuSectionKey } from './api/types';
import { CartBar } from './components/CartBar';
import { CartSheet } from './components/CartSheet';
import { CategoryNav } from './components/CategoryNav';
import { Header } from './components/Header';
import { ItemSheet } from './components/ItemSheet';
import { OrderStatus } from './components/OrderStatus';
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
import { useCartOrder } from './useCartOrder';
import { useLiveMenu } from './useLiveMenu';

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
  // La fiche suit l'article par son id : elle voit les ruptures reçues pendant qu'elle est ouverte.
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const closeSheet = useCallback(() => setOpenItemId(null), []);
  const closeCart = useCallback(() => setCartOpen(false), []);

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
  const setMenu = useCallback((update: (menu: MenuResponse) => MenuResponse) => {
    setState((current) =>
      current.status === 'ready' ? { status: 'ready', menu: update(current.menu) } : current,
    );
  }, []);
  useLiveMenu(tableToken, menu, setMenu);

  const categories = useMemo(() => (menu ? visibleCategories(menu) : []), [menu]);
  const items = useMemo(() => (menu ? itemsById(menu) : new Map<number, MenuItem>()), [menu]);
  // Articles qu'on ne peut plus commander (rupture, hors horaire) : signalés dans le panier.
  const unavailableIds = useMemo(
    () => [...items.values()].filter((item) => !item.available).map((item) => item.id),
    [items],
  );
  const cart = useCartOrder(tableToken, unavailableIds);
  // Article devenu hors horaire pendant que sa fiche est ouverte : elle se ferme.
  const openItemCandidate = openItemId === null ? undefined : items.get(openItemId);
  const openItem =
    openItemCandidate && openItemCandidate.unavailableReason !== 'outside_hours'
      ? openItemCandidate
      : null;
  const sections = availableSections(categories);
  // Onglet choisi, ou le premier qui a des articles (ex. plus rien en Food).
  const activeSection = sections.includes(section) ? section : sections[0];
  const shown = activeSection ? sectionCategories(categories, activeSection) : [];

  const orderSent = cart.order?.status === 'pending';
  // Commande envoyée : le panier se ferme et l'état de la commande s'affiche en bas.
  const sendOrder = async () => {
    if (await cart.send()) setCartOpen(false);
  };

  const changeSection = (next: MenuSectionKey) => {
    setSection(next);
    // Haut de la carte du nouvel onglet, sous la barre fixe.
    document.getElementById(sectionPanelId)?.scrollIntoView?.({ block: 'start' });
  };

  return (
    <>
      {/* Pendant que la fiche est ouverte, le reste de la page est inerte (focus et lecteur d'écran) */}
      <div className="page" inert={openItem !== null || cartOpen}>
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
                      onOpen={(item) => setOpenItemId(item.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
        {state.status === 'ready' && (
          <CartBar
            lines={cart.lines}
            items={items}
            status={cart.order && <OrderStatus order={cart.order} onDismiss={cart.dismissOrder} />}
            onOpen={() => setCartOpen(true)}
          />
        )}
      </div>
      {menu && openItem && (
        <ItemSheet
          item={openItem}
          items={items}
          choiceGroups={menu.choiceGroups}
          onAdd={(lines) => {
            cart.add(lines);
            setOpenItemId(null);
          }}
          onClose={closeSheet}
        />
      )}
      {menu && cartOpen && (
        <CartSheet
          lines={cart.lines}
          items={items}
          choiceGroups={menu.choiceGroups}
          blockedKeys={cart.blockedKeys}
          sending={cart.sending}
          error={cart.error}
          orderPending={orderSent}
          onQuantity={cart.setQuantity}
          onRemove={cart.remove}
          onSend={() => void sendOrder()}
          onClose={closeCart}
        />
      )}
    </>
  );
}
