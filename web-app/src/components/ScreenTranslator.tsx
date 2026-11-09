'use client';

// Mounted once in the root layout: the screen translator (lib/i18n/screenTranslator.ts) for every page, signed in or not. It renders nothing.
import { useEffect } from 'react';
import { createScreenTranslator } from '@/lib/i18n/screenTranslator';
import { onTranslationChange, translatedLanguage } from '@/lib/i18n/language';

export function ScreenTranslator() {
  useEffect(() => {
    const translator = createScreenTranslator(document, translatedLanguage);
    translator.start();
    // the language changed, or its phrase book arrived: translate again (or put English back)
    const off = onTranslationChange(() => translator.refresh());
    return () => {
      off();
      translator.stop();
    };
  }, []);
  return null;
}
