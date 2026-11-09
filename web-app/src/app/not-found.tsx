import { copy } from "@shared/auth/copy";
import Link from "next/link";
import { Icon } from "@/components/ui";

// Unknown address (404). Offers the one way forward: the sign-in page.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[440px] rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-graphite-100 text-primary">
          <Icon name="link_off" size={24} />
        </div>
        <h1 className="text-title font-bold text-ink">We couldn&apos;t find that page</h1>
        <Link
          href="/login"
          className="hms-press mt-6 inline-flex h-12 w-full items-center justify-center rounded-button bg-primary px-5 text-body-lg font-semibold text-on-primary hover:bg-primary-hover"
        >
          {copy.common.backToSignIn}
        </Link>
      </div>
    </main>
  );
}
