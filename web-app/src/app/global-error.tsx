"use client";

import { copy, errorText } from "@shared/auth/copy";

// Last resort when the root layout itself fails. It replaces the layout, so it brings its own document and its own
// small style block with plain values (no tokens and no kit components: the app's CSS and the theme variables are not loaded here,
// and the page must still draw when they are missing). Follows the device colour scheme.
const css = `
.hms-fatal { margin: 0; font-family: system-ui, sans-serif; color-scheme: light dark; }
.hms-fatal main { min-height: 100dvh; display: grid; place-items: center; padding: 16px; }
.hms-fatal [role="alert"] { max-width: 420px; text-align: center; }
.hms-fatal p { font-size: 18px; }
.hms-fatal button { min-height: 48px; padding: 0 24px; margin-top: 16px; border-radius: 12px; border: 0; background: #2B2B31; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
`;

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en-IN">
      <head>
        <style>{css}</style>
      </head>
      <body className="hms-fatal">
        <main>
          <div role="alert">
            <p>{errorText.UNKNOWN}</p>
            <button type="button" onClick={() => retry()}>
              {copy.common.tryAgain}
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
