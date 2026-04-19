// tests/unit/messaging-pubsub.test.ts
import { describe, it, expect, vi } from "vitest";
import { messagingPubsub } from "@/server/services/messaging/pubsub";

describe("messagingPubsub", () => {
  it("delivers emitted messages to subscribers on the same channel", () => {
    const handler = vi.fn();
    const unsub = messagingPubsub.on("case:abc", handler);
    messagingPubsub.emit("case:abc", { id: "m1" });
    expect(handler).toHaveBeenCalledWith({ id: "m1" });
    unsub();
  });

  it("does not deliver to subscribers on other channels", () => {
    const handler = vi.fn();
    const unsub = messagingPubsub.on("case:abc", handler);
    messagingPubsub.emit("case:xyz", { id: "m1" });
    expect(handler).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops further delivery", () => {
    const handler = vi.fn();
    const unsub = messagingPubsub.on("case:abc", handler);
    unsub();
    messagingPubsub.emit("case:abc", { id: "m1" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers on the same channel", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = messagingPubsub.on("case:multi", a);
    const unsubB = messagingPubsub.on("case:multi", b);
    messagingPubsub.emit("case:multi", { id: "m2" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });
});
