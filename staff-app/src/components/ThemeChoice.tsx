import { useState } from 'react';
import { t } from '../i18n/fr';
import { loadTheme, saveTheme, THEME_CHOICES, type ThemeChoice as Choice } from '../theme';

// Thème de l'app dans « Moi » : Auto (comme le téléphone), Clair ou Sombre.
export function ThemeChoice() {
  const [choice, setChoice] = useState<Choice>(loadTheme);
  const choose = (next: Choice) => {
    saveTheme(next);
    setChoice(next);
  };
  return (
    <fieldset className="segmented">
      <legend className="segmented__legend">{t('theme.title')}</legend>
      <div className="segmented__options">
        {THEME_CHOICES.map((option) => (
          <label key={option} className="segmented__option">
            <input
              type="radio"
              name="theme"
              value={option}
              checked={choice === option}
              onChange={() => choose(option)}
            />
            <span>{t(`theme.${option}`)}</span>
          </label>
        ))}
      </div>
      {choice === 'auto' && <p className="field__hint">{t('theme.autoHint')}</p>}
    </fieldset>
  );
}
