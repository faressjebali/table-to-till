import type { Lang } from '../api/types';
import { useLanguage } from '../i18n/useLanguage';

const LANGS: Lang[] = ['fr', 'en'];

export function LanguageSwitch() {
  const { lang, setLang, t } = useLanguage();

  return (
    <div className="lang-switch" role="group" aria-label={t('language.label')}>
      {LANGS.map((option) => (
        <button
          key={option}
          type="button"
          className="lang-switch__option"
          lang={option}
          aria-pressed={lang === option}
          aria-label={t(`language.${option}`)}
          onClick={() => setLang(option)}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
