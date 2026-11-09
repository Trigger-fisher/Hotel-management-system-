import { permanentRedirect } from "next/navigation";

// The website's first address (commit c394e53, 25 Oct 2026). It moved to "/" the same day; a link to /welcome lands there.
export default function WelcomePage() {
  permanentRedirect("/");
}
