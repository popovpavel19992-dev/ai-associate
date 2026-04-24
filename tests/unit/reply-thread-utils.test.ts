// tests/unit/reply-thread-utils.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildReplyThread,
  type InboundReplyNode,
  type OutboundReplyNode,
  type ThreadNode,
} from "@/components/cases/emails/reply-thread-utils";

function inbound(
  id: string,
  overrides: Partial<InboundReplyNode> = {},
): InboundReplyNode {
  return {
    kind: "inbound_reply",
    id,
    messageId: `<msg-${id}@example.com>`,
    inReplyTo: null,
    fromEmail: "client@example.com",
    fromName: "Client",
    subject: `Re: Subject ${id}`,
    bodyHtml: `<p>${id}</p>`,
    replyKind: "human",
    senderMismatch: false,
    receivedAt: new Date("2026-04-20T10:00:00Z"),
    attachments: [],
    ...overrides,
  };
}

function outbound(
  id: string,
  parentReplyId: string,
  overrides: Partial<OutboundReplyNode> = {},
): OutboundReplyNode {
  return {
    kind: "outbound_reply",
    id,
    subject: `Re: ${id}`,
    bodyHtml: `<p>out-${id}</p>`,
    parentReplyId,
    inReplyTo: null,
    createdAt: new Date("2026-04-20T11:00:00Z"),
    sentByName: "Lawyer",
    ...overrides,
  };
}

describe("buildReplyThread", () => {
  it("1 inbound reply (no nest) → 1 root", () => {
    const { roots, autoReplies } = buildReplyThread([inbound("a")], [], null);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe("a");
    expect(roots[0].depth).toBe(0);
    expect(roots[0].children).toEqual([]);
    expect(autoReplies).toEqual([]);
  });

  it("inbound whose inReplyTo = another inbound's messageId → nested", () => {
    const a = inbound("a", { messageId: "<m-a>" });
    const b = inbound("b", { inReplyTo: "<m-a>", messageId: "<m-b>" });
    const { roots } = buildReplyThread([a, b], [], null);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe("a");
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].id).toBe("b");
    expect(roots[0].children[0].depth).toBe(1);
  });

  it("outbound replying to inbound → appears as child of inbound", () => {
    const a = inbound("a");
    const o = outbound("o1", "a");
    const { roots } = buildReplyThread([a], [o], null);
    expect(roots[0].children).toHaveLength(1);
    const child = roots[0].children[0];
    expect(child.kind).toBe("outbound_reply");
    expect(child.id).toBe("o1");
    expect(child.depth).toBe(1);
  });

  it("outbound replying to inbound that is itself a child → 3 levels deep", () => {
    const a = inbound("a", { messageId: "<m-a>" });
    const b = inbound("b", { messageId: "<m-b>", inReplyTo: "<m-a>" });
    const o = outbound("o1", "b");
    const { roots } = buildReplyThread([a, b], [o], null);
    expect(roots).toHaveLength(1);
    expect(roots[0].depth).toBe(0);
    expect(roots[0].children[0].depth).toBe(1);
    expect(roots[0].children[0].children[0].depth).toBe(2);
    expect(roots[0].children[0].children[0].id).toBe("o1");
  });

  it("auto-reply excluded from roots, included in autoReplies list", () => {
    const a = inbound("a");
    const auto = inbound("auto1", { replyKind: "auto_reply" });
    const { roots, autoReplies } = buildReplyThread([a, auto], [], null);
    expect(roots.map((r) => r.id)).toEqual(["a"]);
    expect(autoReplies.map((r) => r.id)).toEqual(["auto1"]);
  });

  it("6-level deep chain → depth capped at 4", () => {
    const nodes: InboundReplyNode[] = [];
    for (let i = 0; i < 6; i++) {
      nodes.push(
        inbound(`n${i}`, {
          messageId: `<m-${i}>`,
          inReplyTo: i === 0 ? null : `<m-${i - 1}>`,
        }),
      );
    }
    const { roots } = buildReplyThread(nodes, [], null);
    let cur: ThreadNode | undefined = roots[0];
    const depths: number[] = [];
    while (cur) {
      depths.push(cur.depth);
      cur = cur.children[0];
    }
    expect(depths).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it("sorts siblings at each level by timestamp ASC", () => {
    const later = inbound("later", {
      receivedAt: new Date("2026-04-20T12:00:00Z"),
    });
    const earlier = inbound("earlier", {
      receivedAt: new Date("2026-04-20T08:00:00Z"),
    });
    const mid = inbound("mid", {
      receivedAt: new Date("2026-04-20T10:00:00Z"),
    });
    const { roots } = buildReplyThread([later, earlier, mid], [], null);
    expect(roots.map((r) => r.id)).toEqual(["earlier", "mid", "later"]);
  });

  it("inbound whose inReplyTo points to a message-id we don't have → treated as root", () => {
    const a = inbound("a", { inReplyTo: "<missing-external>" });
    const { roots } = buildReplyThread([a], [], null);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe("a");
  });

  it("orphan outbound (parent not in set) is silently skipped", () => {
    const o = outbound("o1", "nonexistent-inbound");
    const { roots } = buildReplyThread([], [o], null);
    expect(roots).toEqual([]);
  });

  describe("cycle detection", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("breaks circular inbound->inbound reference", () => {
      // a.inReplyTo = b.messageId, b.inReplyTo = a.messageId → cycle
      const a = inbound("a", { messageId: "<m-a>", inReplyTo: "<m-b>" });
      const b = inbound("b", { messageId: "<m-b>", inReplyTo: "<m-a>" });
      const { roots } = buildReplyThread([a, b], [], null);
      // Should not throw / infinite loop. Roots should include both nodes
      // one way or another (one as the resolved root, one promoted after cycle break).
      const ids = new Set<string>();
      function collect(n: ThreadNode) {
        ids.add(n.id);
        n.children.forEach(collect);
      }
      roots.forEach(collect);
      expect(ids.has("a")).toBe(true);
      expect(ids.has("b")).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
