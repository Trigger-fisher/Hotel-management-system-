import "server-only";
import { z } from "zod";

// The queries of the report and dashboard routes. Strict: unknown keys refused; dates and months checked again by the service.
export const dailyQuery = z.strictObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export const occupancyQuery = z.strictObject({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
export const foodPlanQuery = z.strictObject({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), plan: z.string().trim().max(20).optional() });
