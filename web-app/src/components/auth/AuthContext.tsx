"use client";

import { createContext, useContext } from "react";
import type { DeviceInfo, PallavAuthApi, PallavAuthEvent, PallavAuthState } from "@shared/auth-pallav";

export type Tone = "danger" | "warning" | "info" | "success";
export type Direction = "forward" | "back";

/** A message carried into the next step, e.g. "That code has expired…" on signIn. */
export interface Notice {
  tone: Tone;
  text: string;
}

/** Filled into the sign-in form by the dev-only DemoAccounts panel. */
export interface Prefill {
  username: string;
  password: string;
  nonce: number;
}

export interface AuthContextValue {
  state: PallavAuthState;
  /** Moves the flow (animated). `notice` shows a Banner on the next step. */
  send(event: PallavAuthEvent, opts?: { direction?: Direction; notice?: Notice }): void;
  /** Keeps the typed username in the flow state (not animated). */
  setUsername(username: string): void;
  api: PallavAuthApi;
  device: DeviceInfo;
  online: boolean;
  notice: Notice | null;
  prefill: Prefill | null;
  setPrefill(p: Omit<Prefill, "nonce">): void;
  /** Reads text out through the shell's live region (screen readers). */
  announce(text: string): void;
  /** Seconds left before the idle lock while the warning shows; else null. */
  idleWarningSeconds: number | null;
  staySignedIn(): void;
  /** The dashboard on screen came from the server render (R48): its first client render must equal that HTML. False for every later sign-in. */
  seeded: boolean;
  /** The saved panel choices read by the server (R48), for the dashboard that came from the server render. */
  panels: import("@/lib/shellPanels").ShellPanels | null;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthApp>");
  return ctx;
}
