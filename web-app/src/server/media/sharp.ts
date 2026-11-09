import "server-only";
import type sharp from "sharp";

// The ONE place sharp is loaded. Its native library (libvips, about 18 MB) took 1.7 s to load on a cold disk and sat in every function's import graph through the
// profile and website services; loaded here on first use instead, a request that never touches a picture never pays for it. The type-only import above is
// erased, so this module itself costs nothing at start.
let loading: Promise<typeof sharp> | undefined;

/** The sharp function, loaded once per process on the first call. */
export const sharpOf = (): Promise<typeof sharp> => (loading ??= import("sharp").then((m) => m.default));
