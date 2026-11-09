"use client";

import { useState } from "react";
import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import { Button } from "@/components/ui";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const SPECIAL = "!@#$%^&*-_+=?";
const ALL = UPPER + LOWER + DIGIT + SPECIAL;

/** One random index below `max`, without modulo bias (crypto.getRandomValues, never Math.random). */
function pick(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % max;
}

/** A 16-character password made in the browser that meets every rule (upper, lower, number, special), shuffled. Look-alike characters are left out. */
export function suggestPassword(length = 16): string {
  const chars = [UPPER, LOWER, DIGIT, SPECIAL].map((set) => set[pick(set.length)]);
  while (chars.length < length) chars.push(ALL[pick(ALL.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** "Suggest a strong password": makes one, fills both password fields (through `onUse`), and lets the person show it and copy it. */
export function PasswordSuggest({ onUse, disabled }: { onUse: (password: string) => void; disabled?: boolean }) {
  const t = useCopy(pallavCopyByLanguage).resetLink;
  const [made, setMade] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const make = () => {
    const pw = suggestPassword();
    setMade(pw);
    setShown(true);
    setCopied(false);
    onUse(pw);
  };
  const copyIt = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setShown(true);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button label={t.suggest} variant="secondary" icon="key" disabled={disabled} onPress={make} />
      {made ? (
        <div className="flex items-center gap-2 rounded-input border border-hairline px-3 py-2">
          <output className="min-w-0 flex-1 break-all font-mono text-[14px] text-ink" aria-label={t.suggest}>
            {shown ? made : "•".repeat(made.length)}
          </output>
          <Button label={shown ? t.hide : t.show} variant="ghost" size="sm" onPress={() => setShown((s) => !s)} />
          <Button label={copied ? t.copied : t.copy} variant="ghost" size="sm" onPress={() => void copyIt()} />
        </div>
      ) : null}
      <p className="text-[12px] leading-[1.5] text-ink-muted">{t.suggestHint}</p>
    </div>
  );
}
