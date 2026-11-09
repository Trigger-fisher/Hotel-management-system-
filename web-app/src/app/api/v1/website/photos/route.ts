import "server-only";
import { getWebsiteGallery } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { photosBody, siteListQuery } from "@/server/services/website/schemas";

// The gallery: the photos in order; uploading a batch (files as base64 inside the JSON, 10 a request, up to 20 MB each; every photo is stored as WebP of at most 1 MB).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "website.gallery", level: "view" },
  cache: "private, no-cache",
  query: siteListQuery,
  handler: async ({ session, query }) => ({ data: await getWebsiteGallery().list(session, query.search) }),
});

export const POST = route({
  permission: { key: "website.gallery", level: "create" },
  body: photosBody,
  maxBodyBytes: 60 * 1024 * 1024,
  handler: async ({ session, body, request, traceId }) => ({ data: await getWebsiteGallery().add(session, body, requestMeta(request, traceId)), status: 201 }),
});