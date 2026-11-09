import "server-only";
import { formatINR } from "@shared/dashboards/format";
import { paiseToNumber } from "../money/paise";
import type { HandoverRepos } from "../repos/handovers";
import type { Unit } from "../repos/types";
import type { RecycleSource } from "../services/admin/recycleService";
import type { HandoverService } from "../services/handover/handoverService";

// The recycle bin's adapter for Shift Handovers (Pallav "handover", Models/ShiftHandover uses Recyclable): lists the deleted handovers by the repository
// and restores or removes each by the handover service itself (its SuperAdmin rule and its "Restored by" line). Spec: docs/specs/admin.md §9.

interface HandoverSourceDeps {
  unit: Unit<HandoverRepos>;
  handovers: () => HandoverService;
}

const day = (iso: string): string => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

export function handoverRecycleSources(deps: HandoverSourceDeps): RecycleSource[] {
  return [
    {
      key: "handover",
      label: "Handover",
      list: (who) =>
        deps.unit.run(who, async (repos) =>
          (await repos.handovers.rows({ deleted: "only" })).map((h) => ({
            id: h.id,
            title: String(h.entryNo).padStart(4, "0"),
            detail: `${h.shift} shift · ${formatINR(paiseToNumber(h.totalPaise))} on ${day(h.date)}`,
            deletedAt: h.deletedAt as Date,
            deletedBy: h.deletedBy,
          })),
        ),
      restore: async (session, id, meta) => {
        const version = (await deps.unit.run(session, (repos) => repos.handovers.get(id, { deleted: true })))?.version ?? 0;
        await deps.handovers().restore(session, id, version, meta);
      },
      purge: async (session, id) => void (await deps.handovers().purge(session, id)),
      purgeBefore: (hotelId, cutoff) =>
        deps.unit.run({ hotelId, userId: "system" }, async (repos) => {
          let n = 0;
          for (const h of await repos.handovers.rows({ deleted: "only" })) if (h.deletedAt && h.deletedAt < cutoff && (await repos.handovers.purge(h.id))) n += 1;
          return n;
        }),
    },
  ];
}
