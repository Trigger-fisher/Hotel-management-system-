import "server-only";
import { getWebsiteGallery } from "@/server/compose/website";
import { route } from "@/server/http/route";
import { fileParams } from "@/server/services/website/schemas";

// One stored file (photo, icon, logo, browser icon) of the signed-in hotel, for the admin screens. The browser may keep it for an hour (private: never a shared
// cache); a replaced file gets a new name, so a stale copy is never shown. Served as an image only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "website", level: "view" },
  params: fileParams,
  cache: "private, max-age=3600",
  handler: async ({ session, params }) => {
    const f = await getWebsiteGallery().file(session, params.file);
    return { data: null, binary: { bytes: f.bytes, contentType: f.contentType, filename: params.file } };
  },
});