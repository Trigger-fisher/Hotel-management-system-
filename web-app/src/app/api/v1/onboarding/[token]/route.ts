import "server-only";
import { getPlatformInvitations } from "@/server/compose/platform";
import { publicRoute } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { onboardingBody, tokenParams } from "@/server/services/platform/schemas";

// The PUBLIC onboarding page and form (no sign-in; docs/BACKEND.md 14.4). The token is single use and stored only as a keyed hash; an unknown,
// replaced or malformed token gets the same answer. Rate limited per address. The password is hashed on the server and never stored in the form.
export const dynamic = "force-dynamic";

export const GET = publicRoute({
  params: tokenParams,
  limits: [{ name: "onboarding-open", max: 30, windowSeconds: 60, by: "ip" }],
  handler: async ({ params, request, traceId }) => ({ data: await getPlatformInvitations().openByToken(params.token, platformMeta(request, traceId)) }),
});

export const POST = publicRoute({
  params: tokenParams,
  body: onboardingBody,
  idempotency: "off",
  limits: [{ name: "onboarding-submit", max: 10, windowSeconds: 60, by: "ip" }],
  handler: async ({ params, body, request, traceId }) => ({ data: await getPlatformInvitations().submit(params.token, body, platformMeta(request, traceId)), status: 201 }),
});