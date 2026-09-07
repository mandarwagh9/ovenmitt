/** Oven Mitt receipt protocol (v1).
 *
 *  Every lifecycle event is written to Cookie Chain as an SPL Memo instruction in
 *  the same transaction as the action it describes. That makes the audit trail
 *  atomic with the money movement: a receipt cannot exist for a transfer that did
 *  not land, and a transfer under a session cannot land without its receipt.
 *
 *  Memos are kept small (< 400 bytes) so a receipt never dominates the tx. */

export const PROTO = "mitt/1";

export type ReceiptKind = "open" | "act" | "close";

export interface OpenReceipt {
  p: typeof PROTO; t: "open";
  s: string;   // session id (first 8 chars of the agent pubkey)
  a: string;   // agent (session) pubkey
  c: number;   // hard cap, in lamports of COOK
  x: number;   // expiry, unix seconds
  n?: string;  // human label
}
export interface ActReceipt {
  p: typeof PROTO; t: "act";
  s: string;   // session id
  k: string;   // action kind, e.g. "transfer" | "memo" | "swap"
  m?: string;  // short human-readable detail
}
export interface CloseReceipt {
  p: typeof PROTO; t: "close";
  s: string;
  r?: string;  // reason: "revoked" | "expired" | "spent"
}
export type Receipt = OpenReceipt | ActReceipt | CloseReceipt;

export const sessionIdFor = (agentPubkey: string) => agentPubkey.slice(0, 8);

export function encodeReceipt(r: Receipt): string {
  const s = JSON.stringify(r);
  if (Buffer.byteLength(s, "utf8") > 400) throw new Error("receipt too large for a memo");
  return s;
}

/** Tolerant parse: memo text is untrusted, arbitrary bytes written by anyone. */
export function parseReceipt(memo: string): Receipt | null {
  const start = memo.indexOf("{");
  if (start < 0) return null;
  let o: unknown;
  try { o = JSON.parse(memo.slice(start)); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (r.p !== PROTO) return null;
  if (r.t !== "open" && r.t !== "act" && r.t !== "close") return null;
  if (typeof r.s !== "string" || !r.s) return null;
  if (r.t === "open") {
    if (typeof r.a !== "string" || typeof r.c !== "number" || typeof r.x !== "number") return null;
  }
  return r as unknown as Receipt;
}

/** Memo text as it appears in RPC logs: `Program log: Memo (len N): "..."` */
export function memosFromLogs(logs: string[] | null | undefined): string[] {
  if (!logs) return [];
  const out: string[] = [];
  for (const l of logs) {
    const m = l.match(/Memo \(len \d+\): "([\s\S]*)"$/);
    if (m) out.push(m[1].replace(/\\"/g, '"'));
  }
  return out;
}
