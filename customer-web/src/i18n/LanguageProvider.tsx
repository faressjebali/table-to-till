import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '../api/types';
import { LanguageContext } from './context';
import type { MessageKey } from './fr';
import { initialLang, messages, saveLang } from './language';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveLang(next);
  }, []);

  const value = useMemo(
    () => ({ lang, setLang, t: (key: MessageKey) => messages[lang][key] }),
    [lang, setLang],
  );

  return <LanguageContext value={value}>{children}</LanguageContext>;
}
