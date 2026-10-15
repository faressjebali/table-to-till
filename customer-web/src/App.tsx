import { Header } from './components/Header';
import { useLanguage } from './i18n/useLanguage';

export function App() {
  const { t } = useLanguage();

  return (
    <>
      <Header />
      <main className="main">
        <h1 className="page-title">{t('menu.title')}</h1>
        <p className="intro">{t('menu.intro')}</p>
      </main>
      <footer className="footer">
        <p className="counter-hint">{t('menu.counterHint')}</p>
      </footer>
    </>
  );
}
