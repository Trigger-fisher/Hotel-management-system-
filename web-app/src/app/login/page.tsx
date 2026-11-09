import { redirect } from "next/navigation";
import { AuthEntry } from "@/components/auth/AuthEntry";
import { getSessionEnd, getShellSeed, hasSessionCookie } from "@/server/shell/seed";

// The sign-in page (MJ, 25 Oct 2026): "/" is the public website, sign-in lives here. The website's "Sign in" buttons open it.
// A person who is already signed in goes straight to their dashboard at "/". The page reads the session cookie, so it is never cached
// (proxy.ts sets no-store on this address).
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getShellSeed()) redirect("/");
  const [ended, cookie] = await Promise.all([getSessionEnd(), hasSessionCookie()]);
  return <AuthEntry ended={ended} noSession={!cookie} />;
}
