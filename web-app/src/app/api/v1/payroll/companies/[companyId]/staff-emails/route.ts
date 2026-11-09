import "server-only";
import { getPayrollStaffEmails } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyParams, staffEmailListQuery, staffEmailSendBody } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.staff", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: staffEmailListQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollStaffEmails().list(session, params.companyId, query) }),
});

// 1 to 100 people; each recorded "sending" and handed to the outbox. The sender is the session.
export const POST = route({
  permission: { key: "payroll.staff", level: "create" },
  params: companyParams,
  body: staffEmailSendBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollStaffEmails().send(session, params.companyId, body, requestMeta(request, traceId)) }),
});
