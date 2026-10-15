import { createContext } from 'react';
import type { Lang } from '../api/types';
import type { MessageKey } from './fr';

export interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey) => string;
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);
