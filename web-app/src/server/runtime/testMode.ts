import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Test mode of an API access key (platform.api_tokens.test_mode, migration 0129; MJ, 18 Oct 2026: "a test mode that stops real mail and real submissions during load
// tests"). The route wrapper (http/wrapper.ts) runs the handler of a call made with such a key inside this context; the places that would reach the outside world ask inTestMode() and do not:
// mail is not queued (mail/outbox), nothing else reaches the outside world. Everything else works as usual, so a
// load test exercises the real code paths. Only the call's own work is in test mode: a mail queued by a person in the browser at the same moment is unaffected.
const context = new AsyncLocalStorage<{ keyName: string }>();

/** Runs the work in test mode (the key's name only for logs). */
export function runInTestMode<T>(keyName: string, work: () => Promise<T>): Promise<T> {
  return context.run({ keyName }, work);
}

/** True inside a call made with a key in test mode: send no real mail. */
export function inTestMode(): boolean {
  return context.getStore() !== undefined;
}
