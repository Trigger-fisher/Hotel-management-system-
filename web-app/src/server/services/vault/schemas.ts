import "server-only";
import { z } from "zod";
import { PERSONAL_VAULT_KINDS } from "@shared/dashboards/personalVault";
import { VAULT_KINDS } from "@shared/dashboards/vault";

// The vault's request shapes (platform 0168). The service checks the lengths again and names the field in error.
export const vaultItemParams = z.strictObject({ id: z.uuid(), itemId: z.uuid() });

export const vaultBody = z.strictObject({
  kind: z.enum(VAULT_KINDS as unknown as [string, ...string[]]).transform((k) => k as (typeof VAULT_KINDS)[number]),
  title: z.string().max(200),
  username: z.string().max(400).nullish(),
  url: z.string().max(1000).nullish(),
  secret: z.string().max(4000).optional(),
  notes: z.string().max(10000).optional(),
  expiresOn: z.string().max(20).nullish(),
});

// My vault (platform 0190): the same shape with its own types
export const personalVaultItemParams = z.strictObject({ itemId: z.uuid() });

export const personalVaultBody = vaultBody.extend({
  kind: z.enum(PERSONAL_VAULT_KINDS as unknown as [string, ...string[]]).transform((k) => k as (typeof PERSONAL_VAULT_KINDS)[number]),
});
