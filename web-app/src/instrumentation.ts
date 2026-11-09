// Runs once when the Next.js server starts. Node runtime only (the database driver and the mail worker never run on the edge): the work lives in
// instrumentation-node.ts, imported inside this exact check so the edge bundle never contains it.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
