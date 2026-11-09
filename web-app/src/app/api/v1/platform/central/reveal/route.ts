import "server-only";
import { getCentralConsole } from "@/server/compose/centralConsole";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { revealBody } from "@/server/services/platform/centralSchemas";

// Reveal: one full mobile, email or landline of one guest or company profile. It changes nothing; it writes one audit line (who, which profile, which field, when; never the value)
// in the same transaction. Platform Admin and Super Admin; never an API key; never inside a hotel visit; limited per person.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: revealBody,
  idempotency: "optional",
  limits: [{ name: "central-reveal", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getCentralConsole().reveal(session, body, platformMeta(request, traceId)) }),
});
