import "server-only";
import { z } from "zod";
import { DEMO_REQUEST_STATUSES, demoRequestLimits as L } from "@shared/dashboards/demoRequests";

// The demo request shapes (platform 0169). The service checks every field again and names the one in error.
const statuses = DEMO_REQUEST_STATUSES as unknown as [string, ...string[]];
const count = (max: number) => z.number().int().min(1).max(max).nullish();

export const demoRequestBody = z.strictObject({
  name: z.string().max(L.name * 2),
  email: z.string().max(L.email * 2),
  phone: z.string().max(L.phone * 2).nullish(),
  hotelName: z.string().max(L.hotelName * 2),
  city: z.string().max(L.city * 2).nullish(),
  rooms: count(L.rooms),
  properties: count(L.properties),
  message: z.string().max(L.message + 200).nullish(),
  website: z.string().max(200).optional(),
});

export const demoRequestQuery = z.strictObject({
  status: z.enum([...statuses, "all"] as [string, ...string[]]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(5).max(100).optional(),
});

export const demoRequestParams = z.strictObject({ id: z.uuid() });

export const demoRequestStatusBody = z.strictObject({ status: z.enum(statuses) });
