"use client";

import { useEffect, useRef } from "react";
import { registerTurnstileReset, setTurnstileToken, TURNSTILE_SITE_KEY } from "@/lib/auth/turnstile";

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * The Cloudflare security check on the sign-in forms. Mount it inside the form; it keeps its token in lib/auth/turnstile.ts and the request adds it as a header.
 * Renders nothing when no site key is set (NEXT_PUBLIC_TURNSTILE_SITE_KEY).
 */
export function TurnstileWidget({ className }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !box.current) return;
    const el = box.current;
    let id: string | null = null;
    let gone = false;
    void loadTurnstile()
      .then((api) => {
        if (gone) return;
        id = api.render(el, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "auto",
          callback: (t: string) => setTurnstileToken(t),
          "expired-callback": () => setTurnstileToken(null),
          "error-callback": () => setTurnstileToken(null),
        });
        registerTurnstileReset(() => {
          if (id !== null) api.reset(id);
        });
      })
      .catch(() => setTurnstileToken(null));
    return () => {
      gone = true;
      setTurnstileToken(null);
      registerTurnstileReset(null);
      if (id !== null) window.turnstile?.remove(id);
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} className={className ?? "mt-4 flex justify-center"} />;
}
