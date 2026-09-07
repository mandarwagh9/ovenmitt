import { Connection, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { MEMO_PROGRAM_ID } from "./chain";
import { memosFromLogs, parseReceipt, type Receipt } from "./receipts";

export interface Entry {
  sig: string;
  slot: number;
  blockTime: number | null;
  err: boolean;
  receipt: Receipt;
  /** net lamports moved to/from the session key in this tx */
  delta: number;
  signer: string | null;
}

export interface SessionView {
  agent: string;
  sid: string;
  open: Extract<Receipt, { t: "open" }> | null;
  closed: boolean;
  closeReason?: string;
  entries: Entry[];
  balance: number;
  spent: number;
  cap: number;
  expiresAt: number | null;
}

async function fetchParsed(c: Connection, sigs: string[]): Promise<(ParsedTransactionWithMeta | null)[]> {
  const out: (ParsedTransactionWithMeta | null)[] = [];
  for (let i = 0; i < sigs.length; i += 25) {
    const chunk = sigs.slice(i, i + 25);
    const got = await c.getParsedTransactions(chunk, { maxSupportedTransactionVersion: 0 });
    out.push(...got);
  }
  return out;
}

function deltaFor(tx: ParsedTransactionWithMeta, who: string): number {
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const idx = keys.indexOf(who);
  if (idx < 0 || !tx.meta) return 0;
  return (tx.meta.postBalances[idx] ?? 0) - (tx.meta.preBalances[idx] ?? 0);
}

function entriesFrom(txs: (ParsedTransactionWithMeta | null)[], sigs: string[], who: string): Entry[] {
  const rows: Entry[] = [];
  txs.forEach((tx, i) => {
    if (!tx) return;
    for (const memo of memosFromLogs(tx.meta?.logMessages)) {
      const r = parseReceipt(memo);
      if (!r) continue;
      rows.push({
        sig: sigs[i],
        slot: tx.slot,
        blockTime: tx.blockTime ?? null,
        err: !!tx.meta?.err,
        receipt: r,
        delta: deltaFor(tx, who),
        signer: tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58() ?? null,
      });
    }
  });
  return rows;
}

/** Reconstruct a session purely from Cookie Chain state — no database anywhere. */
export async function loadSession(c: Connection, agent: string, limit = 200): Promise<SessionView> {
  const pk = new PublicKey(agent);
  const [sigInfos, balance] = await Promise.all([
    c.getSignaturesForAddress(pk, { limit }),
    c.getBalance(pk).catch(() => 0),
  ]);
  const sigs = sigInfos.map((s) => s.signature);
  const txs = sigs.length ? await fetchParsed(c, sigs) : [];
  const entries = entriesFrom(txs, sigs, agent).sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));

  const open = (entries.find((e) => e.receipt.t === "open")?.receipt ?? null) as SessionView["open"];
  const close = entries.find((e) => e.receipt.t === "close");
  const spent = entries.filter((e) => e.receipt.t === "act" && !e.err).reduce((n, e) => n + Math.max(0, -e.delta), 0);

  return {
    agent, sid: agent.slice(0, 8), open,
    closed: !!close,
    closeReason: close && close.receipt.t === "close" ? close.receipt.r : undefined,
    entries, balance, spent,
    cap: open?.c ?? 0,
    expiresAt: open?.x ?? null,
  };
}

/** Sessions this owner has granted, newest first. */
export async function loadOwnerSessions(c: Connection, owner: string, limit = 120): Promise<string[]> {
  const sigInfos = await c.getSignaturesForAddress(new PublicKey(owner), { limit });
  const sigs = sigInfos.map((s) => s.signature);
  if (!sigs.length) return [];
  const txs = await fetchParsed(c, sigs);
  const agents: string[] = [];
  for (const e of entriesFrom(txs, sigs, owner)) {
    if (e.receipt.t === "open" && !agents.includes(e.receipt.a)) agents.push(e.receipt.a);
  }
  return agents;
}

/** Chain-wide public feed: every Oven Mitt receipt written by anyone. */
export async function loadGlobalFeed(c: Connection, limit = 60): Promise<Entry[]> {
  const sigInfos = await c.getSignaturesForAddress(MEMO_PROGRAM_ID, { limit });
  const sigs = sigInfos.map((s) => s.signature);
  if (!sigs.length) return [];
  const txs = await fetchParsed(c, sigs);
  const rows: Entry[] = [];
  txs.forEach((tx, i) => {
    if (!tx) return;
    for (const memo of memosFromLogs(tx.meta?.logMessages)) {
      const r = parseReceipt(memo);
      if (!r) continue;
      rows.push({
        sig: sigs[i], slot: tx.slot, blockTime: tx.blockTime ?? null,
        err: !!tx.meta?.err, receipt: r, delta: 0,
        signer: tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58() ?? null,
      });
    }
  });
  return rows.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
}
