import { useEffect, useMemo, useState } from 'react';
import { ApiError, getMenu, getTable, type TableInfo } from './api/client';
import type { MenuResponse } from './api/types';
import { CategoryNav } from './components/CategoryNav';
import { Header } from './components/Header';
import { MenuSection } from './components/MenuSection';
import { useLanguage } from './i18n/useLanguage';
import { visibleCategories } from './menu-view';
import { tableTokenFromPath } from './table-link';

type State =
  | { status: 'loading' }
  | { status: 'unknown-table' }
  | { status: 'error' }
  | { status: 'ready'; table: TableInfo; menu: MenuResponse };

// Le client arrive par le lien du QR de sa table (/t/<jeton>, docs/api.md § 3).
export function App() {
  const { t } = useLanguage();
  const tableToken = tableTokenFromPath(window.location.pathname);
  const [state, setState] = useState<State>(
    tableToken ? { status: 'loading' } : { status: 'unknown-table' },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!tableToken) return;
    let ignore = false;
    Promise.all([getTable(tableToken), getMenu()])
      .then(([table, menu]) => {
        if (!ignore) setState({ status: 'ready', table, menu });
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

  const categories = useMemo(
    () => (state.status === 'ready' ? visibleCategories(state.menu) : []),
    [state],
  );

  return (
    <>
      <Header>{categories.length > 0 && <CategoryNav categories={categories} />}</Header>
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
            <p className="table-badge">
              {t('table.label')} {state.table.number}
            </p>
            <h1 className="page-title">{t('menu.title')}</h1>
            <p className="intro">{t('menu.intro')}</p>
            {categories.map((category) => (
              <MenuSection key={category.id} category={category} />
            ))}
          </>
        )}
      </main>
      {state.status === 'ready' && (
        <footer className="footer">
          <p className="counter-hint">{t('menu.counterHint')}</p>
        </footer>
      )}
    </>
  );
}
