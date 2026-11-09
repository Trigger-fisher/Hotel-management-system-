// The languages of the screens (MJ, 3 Nov 2026: three; 4 Nov 2026: French and German added): the translated modules, the helper, the switch and <html lang>.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/i18n.languages.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { copyByLanguage, pickCopy } from "@shared/i18n/copy";
import { LANGUAGES, LANGUAGE_LOCALES, LANGUAGE_NAMES, LANGUAGE_STORAGE_KEY, toLanguage } from "@shared/i18n/languages";
import { translatedModules } from "@shared/i18n/registry";
import { formatDate, formatWeekdayDate, setDisplayLanguage } from "@shared/dashboards/format";
import { translateNavText } from "@shared/dashboards/shellCopy";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { readLanguage, resetLanguageForTests, setLanguage } from "@/lib/i18n/language";

// Latin words that are allowed to stay in Hindi and Gujarati text: brand and product names, tax and payment terms people see in Latin letters, and the
// literal examples inside a sentence (an email, a code format, a key).
const LATIN_ALLOWED = new Set(
  [
    "easyhotelsolutions", "elphinix", "razorpay", "gst", "gstin", "pan", "upi", "otp", "pdf", "qr", "id", "sms", "wifi", "ac", "tv",
    "name", "hotel", "com", "abcde", "a", "z", "sample", "x", "example", "hms", "google", "tcs", "tds", "dr", "cr",
  ].map((s) => s.toLowerCase()),
);

type Leaf = { path: string; value: unknown };

/** Every string, function and array length under a copy object, by path. */
function leaves(value: unknown, path = ""): Leaf[] {
  if (typeof value === "string" || typeof value === "function") return [{ path, value }];
  if (Array.isArray(value)) return [{ path: `${path}.length`, value: value.length }, ...value.flatMap((v, i) => leaves(v, `${path}[${i}]`))];
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [{ path, value }];
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

/** A function in a copy object: called with plain sample arguments (text, numbers, a list of names), it must give back text. */
function call(fn: unknown): string {
  const f = fn as (...a: unknown[]) => unknown;
  const argSets: unknown[][] = [["Sample", 2, 3, "Sample"], [["Sample"], 2, 3, "Sample"], [2, 3, 4, "Sample"], ["corporate.bills"]];
  for (const args of argSets) {
    try {
      const out = f(...args);
      if (typeof out === "string") return out;
    } catch {
      /* try the next set of sample arguments */
    }
  }
  assert.fail("a copy function gave no text for any sample arguments");
}

describe("every translated module has exactly the English keys in Hindi and Gujarati", () => {
  assert.ok(translatedModules.length >= 17);
  for (const mod of translatedModules) {
    for (const lang of ["hi", "gu"] as const) {
      test(`${mod.name}: ${lang}`, () => {
        const en = leaves(mod.words.en);
        const other = leaves(mod.words[lang]);
        assert.ok(mod.words[lang], `${mod.name} has no ${lang} object`);
        const enPaths = en.map((l) => l.path);
        const otherPaths = other.map((l) => l.path);
        assert.deepEqual(
          enPaths.filter((p) => !otherPaths.includes(p)),
          [],
          `${mod.name} ${lang}: missing keys`,
        );
        assert.deepEqual(
          otherPaths.filter((p) => !enPaths.includes(p)),
          [],
          `${mod.name} ${lang}: extra keys`,
        );
        const otherByPath = new Map(other.map((l) => [l.path, l.value]));
        for (const { path, value } of en) {
          const v = otherByPath.get(path);
          if (typeof value === "function") {
            assert.equal(typeof v, "function", `${mod.name} ${lang} ${path}: must be a function`);
            const text = call(v);
            assert.ok(text.trim() !== "", `${mod.name} ${lang} ${path}: empty text`);
            checkLatin(`${mod.name} ${lang} ${path}`, text);
            continue;
          }
          if (typeof value !== "string") continue;
          assert.equal(typeof v, "string", `${mod.name} ${lang} ${path}: must be text`);
          const text = v as string;
          // a text that is empty in English (a deliberately blank line) stays blank
          if (value === "") {
            assert.equal(text, "", `${mod.name} ${lang} ${path}: English is blank`);
            continue;
          }
          assert.ok(text.trim() !== "", `${mod.name} ${lang} ${path}: empty text`);
          assert.equal(placeholders(text), placeholders(value), `${mod.name} ${lang} ${path}: placeholders differ`);
          // icon and tone are not words: they repeat the English value
          if (/\.(icon|tone)$/.test(path)) {
            assert.equal(text, value, `${mod.name} ${lang} ${path}: must repeat the English value`);
            continue;
          }
          checkLatin(`${mod.name} ${lang} ${path}`, text);
        }
      });
    }
  }
});

function checkLatin(where: string, text: string): void {
  // placeholders and the {braces} inside them are not words
  const words = text.replace(/\{\w+\}/g, " ").match(/[A-Za-z]{2,}/g) ?? [];
  const stray = words.filter((w) => !LATIN_ALLOWED.has(w.toLowerCase()));
  assert.deepEqual(stray, [], `${where}: English left in the text "${text}"`);
}

describe("the helper", () => {
  const en = { hello: "Hello", only: "Only English" } as const;
  const hiOnly = copyByLanguage(en, { hello: "नमस्ते", only: "सिर्फ़" }, undefined);
  const none = copyByLanguage(en);

  test("a module with no Hindi or Gujarati object shows English", () => {
    for (const l of LANGUAGES) assert.equal(pickCopy(none, l).hello, "Hello");
  });
  test("a module with only Hindi shows Hindi for hi and English for gu", () => {
    assert.equal(pickCopy(hiOnly, "hi").hello, "नमस्ते");
    assert.equal(pickCopy(hiOnly, "gu").hello, "Hello");
  });
  test("an unknown or missing language value is English", () => {
    for (const v of ["es", "", null, undefined, "HI", 5]) assert.equal(pickCopy(hiOnly, v as never).hello, "Hello");
    assert.equal(toLanguage("zz"), "en");
    assert.equal(toLanguage("gu"), "gu");
  });
  test("TypeScript refuses a missing or an extra key (checked by tsc; the lines below are the proof)", () => {
    // @ts-expect-error a key is missing
    copyByLanguage(en, { hello: "x" });
    // @ts-expect-error an extra key
    copyByLanguage(en, { hello: "x", only: "y", extra: "z" });
    // @ts-expect-error a text is not a number
    copyByLanguage(en, { hello: 5, only: "y" });
  });
  test("the portal menu words are translated by their English text; staff words are left alone", () => {
    assert.equal(translateNavText("Bills", "hi"), "बिल");
    assert.equal(translateNavText("Bills", "en"), "Bills");
    assert.equal(translateNavText("Room types", "gu"), "Room types");
  });
});

// A tiny browser: window, localStorage (can be made to throw), document with a cookie and <html lang>.
function installBrowser(opts: { storageThrows?: boolean; cookiesThrow?: boolean } = {}) {
  const store = new Map<string, string>();
  const doc = { cookie: "", documentElement: { lang: "en-IN" } } as { cookie: string; documentElement: { lang: string } };
  const localStorage = {
    getItem(k: string) {
      if (opts.storageThrows) throw new Error("blocked");
      return store.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (opts.storageThrows) throw new Error("blocked");
      store.set(k, v);
    },
  };
  const g = globalThis as Record<string, unknown>;
  g.window = { localStorage, addEventListener() {}, removeEventListener() {} };
  if (opts.cookiesThrow) Object.defineProperty(doc, "cookie", { get: () => { throw new Error("blocked"); }, set: () => { throw new Error("blocked"); }, configurable: true });
  g.document = doc;
  return { store, doc };
}

describe("the choice is remembered, and <html lang> follows it", () => {
  beforeEach(() => resetLanguageForTests());
  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    delete g.window;
    delete g.document;
    resetLanguageForTests();
  });

  test("no choice yet is English; a chosen language is kept in localStorage and a cookie and sets <html lang>", () => {
    const { store, doc } = installBrowser();
    assert.equal(readLanguage(), "en");
    setLanguage("hi");
    assert.equal(readLanguage(), "hi");
    assert.equal(store.get(LANGUAGE_STORAGE_KEY), "hi");
    assert.match(doc.cookie, /hms-lang=hi/);
    assert.equal(doc.documentElement.lang, "hi-IN");
    setLanguage("gu");
    assert.equal(doc.documentElement.lang, "gu-IN");
    setLanguage("en");
    assert.equal(doc.documentElement.lang, "en-IN");
  });

  test("a later page load reads the saved language", () => {
    const { store } = installBrowser();
    store.set(LANGUAGE_STORAGE_KEY, "gu");
    assert.equal(readLanguage(), "gu");
    store.set(LANGUAGE_STORAGE_KEY, "klingon");
    resetLanguageForTests();
    assert.equal(readLanguage(), "en");
  });

  test("when storage and cookies throw, the choice still works until the page closes", () => {
    const { doc } = installBrowser({ storageThrows: true, cookiesThrow: true });
    assert.equal(readLanguage(), "en");
    assert.doesNotThrow(() => setLanguage("hi"));
    assert.equal(readLanguage(), "hi");
    assert.equal(doc.documentElement.lang, "hi-IN");
  });

  test("a value that is not a language is ignored", () => {
    installBrowser();
    setLanguage("hi");
    setLanguage("es" as never);
    assert.equal(readLanguage(), "hi");
  });

  test("the locales: the three Indian ones, then French and German", () => {
    assert.deepEqual(LANGUAGE_LOCALES, { en: "en-IN", hi: "hi-IN", gu: "gu-IN", fr: "fr-FR", de: "de-DE" });
  });
});

describe("dates follow the language, digits stay Latin, and the server side stays English", () => {
  afterEach(() => setDisplayLanguage("en"));
  test("English is the default and is unchanged", () => {
    assert.equal(formatDate("2026-10-25"), "25 Oct 2026");
    assert.equal(formatWeekdayDate("2026-10-25"), "Sun, 25 Oct 2026");
  });
  test("Hindi and Gujarati write the month and weekday in their script with Latin digits", () => {
    setDisplayLanguage("hi");
    assert.equal(formatDate("2026-10-25"), "25 अक्तू॰ 2026");
    assert.equal(formatWeekdayDate("2026-10-25", { long: true }), "रविवार, 25 अक्तू॰ 2026");
    setDisplayLanguage("gu");
    assert.equal(formatDate("2026-10-25"), "25 ઑક્ટો 2026");
    assert.ok(/^[0-9]/.test(formatDate("2026-03-05")) && formatDate("2026-03-05").endsWith("2026"));
  });
  test("an unknown language value is English", () => {
    setDisplayLanguage("es");
    assert.equal(formatDate("2026-10-25"), "25 Oct 2026");
  });
  test("French and German write the month names in their own language, digits stay Latin", () => {
    setDisplayLanguage("fr");
    assert.equal(formatDate("2026-10-25"), "25 oct. 2026");
    assert.equal(formatDate("2026-03-05"), "05 mars 2026".replace(/^0/, "0"));
    setDisplayLanguage("de");
    assert.equal(formatDate("2026-10-25"), "25 Okt. 2026");
    assert.ok(/^[0-9]/.test(formatDate("2026-03-05")) && formatDate("2026-03-05").endsWith("2026"));
  });
});

describe("the one switch", () => {
  test("it shows the five names, each in its own script, and marks the current one", () => {
    const html = renderToStaticMarkup(createElement(LanguageSwitch, { variant: "menu" }));
    for (const l of LANGUAGES) assert.ok(html.includes(`>${LANGUAGE_NAMES[l]}</button>`), `${LANGUAGE_NAMES[l]} is missing`);
    assert.deepEqual(LANGUAGE_NAMES, { en: "English", hi: "हिन्दी", gu: "ગુજરાતી", fr: "Français", de: "Deutsch" });
    // on the server nothing is chosen yet, so English is the pressed one
    assert.match(html, /aria-pressed="true"[^>]*lang="en"|lang="en"[^>]*aria-pressed="true"|is-on[^>]*lang="en"/);
    assert.match(html, /Language/);
  });

  test("one button per language, each calling setLanguage with a valid language and then onChosen", () => {
    const src = readFileSync(join(__dirname, "..", "..", "src", "components", "LanguageSwitch.tsx"), "utf8");
    assert.match(src, /LANGUAGES\.map\(\(l\) =>/);
    assert.match(src, /setLanguage\(l\);\s*onChosen\?\.\(l\);/);
    const html = renderToStaticMarkup(createElement(LanguageSwitch, { variant: "page" }));
    assert.equal((html.match(/<button/g) ?? []).length, 5);
  });

  test("the sign-in card and the header user menu are the two places the one switch is used", () => {
    const root = join(__dirname, "..", "..", "src");
    const shell = readFileSync(join(root, "dashboards", "pallav", "PallavShell.tsx"), "utf8");
    assert.match(shell, /<LanguageSwitch variant="menu" \/>/);
    const menuStart = shell.indexOf("function UserMenu(");
    assert.ok(shell.indexOf('<LanguageSwitch variant="menu" />') > menuStart, "the switch must be inside UserMenu");
    const auth = readFileSync(join(root, "components", "auth", "AuthShell.tsx"), "utf8");
    assert.match(auth, /<LanguageSwitch variant="page" \/>/);
    // no other copy of the switch
    assert.equal(readFileSync(join(root, "components", "LanguageSwitch.tsx"), "utf8").match(/export function/g)?.length, 1);
  });
});

// French and German (4 Nov 2026): a module may have them or not (English is shown where it has not), but one that has them has exactly the English keys.
describe("French and German modules that exist have exactly the English keys", () => {
  for (const mod of translatedModules) {
    for (const lang of ["fr", "de"] as const) {
      const words = mod.words[lang];
      if (!words) continue;
      test(`${mod.name}: ${lang}`, () => {
        const en = leaves(mod.words.en);
        const other = leaves(words);
        const enPaths = en.map((l) => l.path);
        const otherPaths = other.map((l) => l.path);
        assert.deepEqual(enPaths.filter((p) => !otherPaths.includes(p)), [], `${mod.name} ${lang}: missing keys`);
        assert.deepEqual(otherPaths.filter((p) => !enPaths.includes(p)), [], `${mod.name} ${lang}: extra keys`);
        const byPath = new Map(other.map((l) => [l.path, l.value]));
        for (const { path, value } of en) {
          const v = byPath.get(path);
          if (typeof value === "function") {
            assert.equal(typeof v, "function", `${mod.name} ${lang} ${path}: must be a function`);
            assert.ok(call(v).trim() !== "", `${mod.name} ${lang} ${path}: empty text`);
          } else if (typeof value === "string" && value !== "") {
            assert.equal(typeof v, "string", `${mod.name} ${lang} ${path}: must be text`);
            assert.ok((v as string).trim() !== "", `${mod.name} ${lang} ${path}: empty text`);
            assert.equal(placeholders(v as string), placeholders(value), `${mod.name} ${lang} ${path}: placeholders differ`);
            if (/\.(icon|tone)$/.test(path)) assert.equal(v, value, `${mod.name} ${lang} ${path}: must repeat the English value`);
          }
        }
      });
    }
  }
  test("the shell and the switch have French and German", () => {
    for (const name of ["languageSwitch", "shell"]) {
      const mod = translatedModules.find((m) => m.name === name)!;
      assert.ok(mod.words.fr && mod.words.de, `${name} has no French or German`);
    }
    const shellWords = translatedModules.find((m) => m.name === "shell")!.words as unknown as Parameters<typeof pickCopy<{ menu: { signOut: string } }>>[0];
    assert.equal(pickCopy(shellWords, "fr").menu.signOut, "Se déconnecter");
    assert.equal(pickCopy(shellWords, "de").menu.signOut, "Abmelden");
  });
});

describe("the language icon at the header's right-hand corner", () => {
  const shell = readFileSync(join(__dirname, "..", "..", "src", "dashboards", "pallav", "PallavShell.tsx"), "utf8");
  test("it is the last thing in the header's right cluster, after the user menu, and lists every language", () => {
    const userMenu = shell.indexOf("<UserMenu");
    const icon = shell.indexOf("<LanguageMenu />");
    assert.ok(userMenu > 0 && icon > userMenu, "the language icon comes after the user menu");
    // nothing but the end of the cluster follows it
    assert.match(shell.slice(icon, icon + 120), /^<LanguageMenu \/>\s*<\/div>/);
    const menu = shell.slice(shell.indexOf("function LanguageMenu()"));
    assert.match(menu, /LANGUAGES\.map\(\(l\) =>/);
    assert.match(menu, /setLanguage\(l\);/);
    assert.match(menu, /<Bi name="translate" \/>/);
  });
});
