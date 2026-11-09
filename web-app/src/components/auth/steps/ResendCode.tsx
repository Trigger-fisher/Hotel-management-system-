"use client";

import { fill } from "@shared/auth/copy";
import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import type { ApiResult, ResendCodeResult } from "@shared/auth-pallav";
import { SecondaryButton } from "@/components/ui";
import { useAuth } from "../AuthContext";
import { useSubmit } from "../useSubmit";
import { useCountdown } from "./useCountdown";

/** "Send a new code": the call, its busy flag and error (the card shows the error in its own banner). */
/** `beforeResend` runs first, e.g. to clear the card's old error so the "new code sent" notice can show. */
export function useResend(call: (challengeId: string) => Promise<ApiResult<ResendCodeResult>>, beforeResend?: () => void) {
  const { state, send } = useAuth();
  const pallavCopy = useCopy(pallavCopyByLanguage);
  const { busy, error, blocked, run } = useSubmit();
  const seconds = useCountdown(state.resendAt);
  const resend = () => {
    beforeResend?.();
    void run(() => call(state.challengeId ?? ""), {
      onOk: (r) =>
        send(
          { type: "CODE_RESENT", sentTo: r.maskedEmail, resendAfterSeconds: r.resendAfterSeconds, now: Date.now() },
          { notice: { tone: "success", text: pallavCopy.emailCode.resent } },
        ),
    });
  };
  return { busy, error, blocked, seconds, resend };
}

/**
 * The resend control for `useResend`. While the countdown runs it is a plain muted line (no button, nothing
 * disabled); at 0 it becomes the "Send a new code" button. Same pattern as the mobile app.
 */
export function ResendButton({
  resend,
  texts,
  disabled,
}: {
  resend: ReturnType<typeof useResend>;
  texts: { resend: string; resendIn: string };
  disabled?: boolean;
}) {
  if (resend.seconds > 0 && !resend.busy) {
    return <p className="flex min-h-12 items-center justify-center text-center text-[13px] leading-[1.5] text-ink-muted">{fill(texts.resendIn, { seconds: resend.seconds })}</p>;
  }
  return (
    <SecondaryButton type="button" busy={resend.busy} busyLabel={texts.resend} disabled={disabled || resend.blocked} onClick={resend.resend}>
      {texts.resend}
    </SecondaryButton>
  );
}
