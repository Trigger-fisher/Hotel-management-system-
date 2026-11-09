"use client";

import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import { LinkButton } from "@/components/ui";
import { useAuth } from "../AuthContext";

/** "‹ Back to sign in", shown on every sub-step (agreement section 2, item 8). A link: no arrow. */
export function BackToSignIn({ disabled }: { disabled?: boolean }) {
  const { send } = useAuth();
  const authWords = useCopy(authWordsCopyByLanguage);
  return (
    <LinkButton chevron disabled={disabled} onClick={() => send({ type: "GO", step: "signIn" }, { direction: "back" })}>
      {authWords.common.backToSignIn}
    </LinkButton>
  );
}
