import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams, paymentsQuery } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// One month's payments: no period = the latest processed month. `page` (with pageSize 10/25/50/100) returns one page of rows plus `page`;
// without it every row of the month. `status`, `search` (name, code, designation, reference) and `sort`/`dir` apply before paging; `page.total`
// counts the filtered rows, the summary always the whole month.
export const GET = route({
  permission: { key: "payroll.salary-payment", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: paymentsQuery,
  handler: async ({ session, params, query }) => ({
    data: await getPayrollPayments().month(session, params.companyId, query.period, query.page === undefined ? undefined : { page: query.page, pageSize: query.pageSize }, {
      status: query.status,
      search: query.search,
      sort: query.sort,
      dir: query.dir,
    }),
  }),
});
