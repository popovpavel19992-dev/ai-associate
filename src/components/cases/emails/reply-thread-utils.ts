// src/components/cases/emails/reply-thread-utils.ts
// Pure tree-building utilities for threaded email replies.
// No React / JSX — safe to unit test in Node.

export interface InboundReplyNode {
  kind: "inbound_reply";
  id: string;
  messageId: string | null;
  inReplyTo: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  bodyHtml: string;
  replyKind: "human" | "auto_reply";
  senderMismatch: boolean;
  receivedAt: Date | string;
  attachments: {
    id: string;
    filename: string;
    sizeBytes: number;
    promotedDocumentId: string | null;
  }[];
}

export interface OutboundReplyNode {
  kind: "outbound_reply";
  id: string;
  subject: string;
  bodyHtml: string;
  parentReplyId: string;
  inReplyTo: string | null; // RFC header
  createdAt: Date | string;
  sentByName: string | null;
}

export type ThreadNode = (InboundReplyNode | OutboundReplyNode) & {
  children: ThreadNode[];
  depth: number;
};

const MAX_DEPTH = 4;

function toTime(d: Date | string): number {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function nodeTimestamp(node: ThreadNode): number {
  return node.kind === "inbound_reply"
    ? toTime(node.receivedAt)
    : toTime(node.createdAt);
}

export function buildReplyThread(
  inboundReplies: InboundReplyNode[],
  outboundReplies: OutboundReplyNode[],
  _outreachMessageId: string | null,
): { roots: ThreadNode[]; autoReplies: InboundReplyNode[] } {
  // 1. Peel off auto-replies — they never go into the tree.
  const autoReplies: InboundReplyNode[] = [];
  const humanInbound: InboundReplyNode[] = [];
  for (const r of inboundReplies) {
    if (r.replyKind === "auto_reply") autoReplies.push(r);
    else humanInbound.push(r);
  }

  // 2. Build ThreadNodes for every human inbound + every outbound.
  const inboundNodes = new Map<string, ThreadNode>();
  for (const r of humanInbound) {
    inboundNodes.set(r.id, { ...r, children: [], depth: 0 });
  }
  const outboundNodes: ThreadNode[] = outboundReplies.map((o) => ({
    ...o,
    children: [],
    depth: 0,
  }));

  // 3. Lookup: inbound by its own messageId (for resolving inReplyTo targets).
  const inboundByMessageId = new Map<string, ThreadNode>();
  for (const n of inboundNodes.values()) {
    if (n.kind === "inbound_reply" && n.messageId) {
      inboundByMessageId.set(n.messageId, n);
    }
  }

  const roots: ThreadNode[] = [];

  // 4. Attach inbound human replies: either nested under another inbound, or root.
  for (const node of inboundNodes.values()) {
    if (node.kind !== "inbound_reply") continue;
    const parent = node.inReplyTo
      ? inboundByMessageId.get(node.inReplyTo)
      : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // 5. Attach outbound replies as children of their parentReplyId inbound.
  for (const out of outboundNodes) {
    if (out.kind !== "outbound_reply") continue;
    const parent = inboundNodes.get(out.parentReplyId);
    if (parent) {
      parent.children.push(out);
    } else {
      // Orphan outbound (parent inbound not in this outreach's set) → skip.
      // Shouldn't happen per backend invariants but be defensive.
      continue;
    }
  }

  // 6. Compute depth recursively with cycle detection + clamp at MAX_DEPTH.
  //    Also sort siblings at each level by timestamp ASC.
  const visited = new Set<string>();

  function walk(node: ThreadNode, depth: number): void {
    visited.add(node.id);
    node.depth = Math.min(depth, MAX_DEPTH);
    // Filter out any child that would create a cycle (already visited).
    const safeChildren: ThreadNode[] = [];
    for (const child of node.children) {
      if (visited.has(child.id)) {
        console.warn(
          `[buildReplyThread] circular reference detected at node ${child.id}; breaking cycle`,
        );
        continue;
      }
      safeChildren.push(child);
    }
    node.children = safeChildren;
    node.children.sort((a, b) => nodeTimestamp(a) - nodeTimestamp(b));
    const childDepth = Math.min(depth + 1, MAX_DEPTH);
    for (const child of node.children) {
      walk(child, childDepth);
    }
  }

  roots.sort((a, b) => nodeTimestamp(a) - nodeTimestamp(b));
  for (const root of roots) walk(root, 0);

  // Any nodes not yet visited are part of a cycle that has no root entry.
  // Promote the earliest such node per connected cycle to a root.
  // Only inbound nodes can be cycle-orphans; outbound orphans (missing parent)
  // were intentionally skipped in step 5 and must stay out of the tree.
  const allNodes: ThreadNode[] = [...inboundNodes.values()];
  const stillUnvisited = allNodes.filter((n) => !visited.has(n.id));
  if (stillUnvisited.length > 0) {
    stillUnvisited.sort((a, b) => nodeTimestamp(a) - nodeTimestamp(b));
    for (const orphan of stillUnvisited) {
      if (visited.has(orphan.id)) continue;
      console.warn(
        `[buildReplyThread] promoting cycle-orphan node ${orphan.id} to root`,
      );
      roots.push(orphan);
      walk(orphan, 0);
    }
  }
  roots.sort((a, b) => nodeTimestamp(a) - nodeTimestamp(b));

  return { roots, autoReplies };
}
