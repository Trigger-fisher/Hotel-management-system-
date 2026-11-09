import "server-only";
import { createDocumentRenderer, type DocumentRendererPort } from "./renderer";

export type { DocumentData, DocumentKind, DocumentRendererPort, RenderedDocument } from "./renderer";
export { createDocumentRenderer } from "./renderer";

let shared: DocumentRendererPort | null = null;
/** The process's renderer (its queue is per process). */
export const getDocumentRenderer = (): DocumentRendererPort => (shared ??= createDocumentRenderer());

/** Replaces the process's renderer (tests give it a long deadline so a loaded machine cannot fail a render that is merely slow). */
export function configureDocumentRenderer(next: DocumentRendererPort | null): void {
  shared = next;
}
