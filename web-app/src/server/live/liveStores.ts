import "server-only";
import type { SaveTarget, WaInboxStore } from "../whatsapp/inbound";
import type { WaSendStore } from "../whatsapp/sendPorts";
import { PLATFORM_BOX, type ConvChange, type LiveBox } from "./convLive";

// The WhatsApp paths that write a conversation outside a hub's unit: a guest's message from Meta's webhook (and its file, its reaction) and the send pipeline (a reply
// waiting, then sent or failed). Each publishes after its own write returned.

export const boxOfTarget = (target: SaveTarget): LiveBox => (target.kind === "hotel" ? { kind: "hotel", id: target.hotelId } : PLATFORM_BOX);

export function liveWaInbox(store: WaInboxStore, publish: (changes: ConvChange[]) => void): WaInboxStore {
  return {
    ...store,
    async saveInbound(target, message, lineId) {
      const r = await store.saveInbound(target, message, lineId);
      if (r.created) publish([{ box: boxOfTarget(target), ids: r.conversationIds ?? [], what: "message" }]);
      return r;
    },
    async applyReaction(target, reaction) {
      const done = await store.applyReaction(target, reaction);
      if (done) publish([{ box: boxOfTarget(target), ids: [], what: "meta" }]);
      return done;
    },
    ...(store.attachMedia
      ? {
          async attachMedia(target: SaveTarget, wamid: string, patch: Record<string, unknown>) {
            await store.attachMedia!(target, wamid, patch);
            publish([{ box: boxOfTarget(target), ids: [], what: "meta" }]);
          },
        }
      : {}),
  };
}

export function liveSendStore(store: WaSendStore, publish: (changes: ConvChange[]) => void): WaSendStore {
  return {
    ...store,
    async insertPending(message) {
      const r = await store.insertPending(message);
      if (r.created) publish([{ box: boxOfTarget(message.scope), ids: [], what: "message" }]);
      return r;
    },
    async updateMessage(scope, id, patch) {
      await store.updateMessage(scope, id, patch);
      publish([{ box: boxOfTarget(scope), ids: [], what: "status" }]);
    },
  };
}
