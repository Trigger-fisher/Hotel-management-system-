'use client';

// The ONE language switch (MJ, 3 Nov 2026). Three choices, each written in its own script. It sits inside the header's user menu on every dashboard
// (variant "menu", dashboards/pallav/PallavShell.tsx) and, because the sign-in page has no user menu, alone in the corner of the sign-in card (variant "page").
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '@shared/i18n/languages';
import { languageSwitchCopyByLanguage } from '@shared/i18n/words';
import { useCopy, useLanguage } from '@/lib/i18n/language';

/** `bare`: no visible "Language" word, for a page that already labels the switch (My profile); the group keeps its spoken name. */
export function LanguageSwitch({ variant, onChosen, bare = false }: { variant: 'menu' | 'page'; onChosen?: (language: Language) => void; bare?: boolean }) {
  const [language, setLanguage] = useLanguage();
  const words = useCopy(languageSwitchCopyByLanguage);
  return (
    <div className={`lang-switch lang-switch-${variant}`} role="group" aria-label={words.group}>
      {bare ? null : <span className="lang-switch-label">{words.label}</span>}
      <span className="lang-switch-choices">
        {LANGUAGES.map((l) => (
          <button /* check-shared-ignore: the language switch's own choice button, the one shared switch */
            key={l}
            type="button"
            className={`lang-switch-btn${l === language ? ' is-on' : ''}`}
            lang={l}
            aria-pressed={l === language}
            onClick={() => {
              setLanguage(l);
              onChosen?.(l);
            }}
          >
            {LANGUAGE_NAMES[l]}
          </button>
        ))}
      </span>
    </div>
  );
}
