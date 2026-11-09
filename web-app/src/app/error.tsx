"use client";

import { copy, errorText } from "@shared/auth/copy";
import { Icon } from "@/components/ui";

// Last-resort fallback (R8): if anything in the app throws, show a calm card instead of a blank page.
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div role="alert" className="w-full max-w-[440px] rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-graphite-100 text-primary">
          <Icon name="error" size={24} />
        </div>
        <p className="text-body-lg text-ink">{errorText.UNKNOWN}</p>
        <button
          type="button"
          onClick={() => retry()}
          className="hms-press mt-6 inline-flex h-12 w-full items-center justify-center rounded-button bg-primary px-5 text-body-lg font-semibold text-on-primary hover:bg-primary-hover"
        >
          {copy.common.tryAgain}
        </button>
      </div>
    </main>
  );
}
