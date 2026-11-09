import "server-only";
import { getCashExpenses } from "@/server/compose/cash";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { expenseCreateBody, expenseListQuery } from "@/server/services/cash/schemas";

// Daily Cash, Expenses: the list (cash withdrawals and miscellaneous expenses) and a new entry. Rules: docs/specs/cash-withdrawals.md, cash-expenses.md.
export const dynamic = "force-dynamic";

// Reading needs the module `expense` (the parts are write-only).
export const GET = route({
  permission: { key: "expense", level: "view" },
  cache: "private, no-cache",
  query: expenseListQuery,
  handler: async ({ session, query }) => ({ data: await getCashExpenses().list(session, query) }),
});

// Recording needs the part `expense.withdrawals` or `expense.misc` at create: the service checks it for the kind in the body.
export const POST = route({
  permission: "session",
  body: expenseCreateBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getCashExpenses().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
