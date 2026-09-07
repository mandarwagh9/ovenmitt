/** Oven Mitt protocol core, in plain ESM so the MCP server runs under bare node
 *  with no build step. This mirrors src/lib/{chain,receipts,session,indexer}.ts,
 *  which stays the canonical TypeScript version used by the web app. Keep the
 *  `mitt/1` wire format identical in both. */

import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";

export const RPC = process.env.COOKIE_RPC ?? "https://rpc.cookiescan.io";
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const LAMPORTS_PER_COOK = 1_000_000_000;
export const EXPLORER = "https://cookiescan.io";

export const conn = () => new Connection(RPC, "confirmed");
export const fmtCook = (l) => (l / LAMPORTS_PER_COOK).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
export const txUrl = (s) => `${EXPLORER}/tx/${s}`;
export const sessionIdFor = (pk) => pk.slice(0, 8);

export function agentFromEnv() {
  const raw = process.env.MITT_SESSION_KEY;
  if (!raw) {
    throw new Error(
      "MITT_SESSION_KEY is not set. Open a session at https://mitt-cookiechain.vercel.app " +
      "and copy its key. Read-only tools work without it.",
    );
  }
  try {
    return Keypair.fromSecretKey(bs58.decode(raw.trim()));
  } catch {
    throw new Error("MITT_SESSION_KEY is not a valid base58 secret key.");
  }
}

export function memoIx(text, signer) {
  return new TransactionInstruction({
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(text, "utf8"),
  });
}

export function parseReceipt(memo) {
  const start = memo.indexOf("{");
  if (start < 0) return null;
  let o;
  try { o = JSON.parse(memo.slice(start)); } catch { return null; }
  if (!o || typeof o !== "object" || o.p !== "mitt/1") return null;
  if (!["open", "act", "close"].includes(o.t)) return null;
  if (typeof o.s !== "string" || !o.s) return null;
  return o;
}

export function memosFromLogs(logs) {
  const out = [];
  for (const l of logs ?? []) {
    const m = l.match(/Memo \(len \d+\): "([\s\S]*)"$/);
    if (m) out.push(m[1].replace(/\\"/g, '"'));
  }
  return out;
}

/** Everything the leash knows about itself, read straight off the chain. */
export async function readSession(c, agentPubkey) {
  const pk = new PublicKey(agentPubkey);
  const [sigInfos, balance] = await Promise.all([
    c.getSignaturesForAddress(pk, { limit: 200 }),
    c.getBalance(pk).catch(() => 0),
  ]);
  const sigs = sigInfos.map((s) => s.signature);
  const txs = sigs.length
    ? await c.getParsedTransactions(sigs, { maxSupportedTransactionVersion: 0 })
    : [];

  const entries = [];
  txs.forEach((tx, i) => {
    if (!tx) return;
    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
    const idx = keys.indexOf(agentPubkey);
    const delta = idx >= 0 && tx.meta
      ? (tx.meta.postBalances[idx] ?? 0) - (tx.meta.preBalances[idx] ?? 0)
      : 0;
    for (const memo of memosFromLogs(tx.meta?.logMessages)) {
      const r = parseReceipt(memo);
      if (r) entries.push({ sig: sigs[i], blockTime: tx.blockTime ?? null, err: !!tx.meta?.err, receipt: r, delta });
    }
  });
  entries.sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));

  const open = entries.find((e) => e.receipt.t === "open")?.receipt ?? null;
  const close = entries.find((e) => e.receipt.t === "close");
  const spent = entries
    .filter((e) => e.receipt.t === "act" && !e.err)
    .reduce((n, e) => n + Math.max(0, -e.delta), 0);

  return {
    agent: agentPubkey,
    sid: sessionIdFor(agentPubkey),
    label: open?.n ?? null,
    cap: open?.c ?? 0,
    spent,
    balance,
    remaining: Math.max(0, (open?.c ?? 0) - spent),
    expiresAt: open?.x ?? null,
    expired: open?.x ? Date.now() / 1000 > open.x : false,
    closed: !!close,
    closeReason: close?.receipt?.r ?? null,
    entries,
  };
}

/** A spend plus its receipt, atomically. Refuses to exceed what the leash holds. */
export async function spend(c, agent, toPubkey, lamports, kind, detail) {
  const to = new PublicKey(toPubkey);
  const balance = await c.getBalance(agent.publicKey);
  const FEE = 5000;
  if (lamports <= 0) throw new Error("Amount must be greater than zero.");
  if (lamports + FEE > balance) {
    throw new Error(
      `The session holds ${fmtCook(balance)} COOK, which cannot cover ` +
      `${fmtCook(lamports)} plus fees. This is the cap doing its job.`,
    );
  }

  const receipt = {
    p: "mitt/1", t: "act",
    s: sessionIdFor(agent.publicKey.toBase58()),
    k: String(kind).slice(0, 24),
    ...(detail ? { m: String(detail).slice(0, 120) } : {}),
  };

  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: agent.publicKey, blockhash, lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));
  tx.add(SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: to, lamports }));
  tx.add(memoIx(JSON.stringify(receipt), agent.publicKey));

  const sim = await c.simulateTransaction(tx);
  if (sim.value.err) throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);

  tx.sign(agent);
  const started = Date.now();
  const sig = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const res = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(res.value.err)}`);
  return { signature: sig, ms: Date.now() - started, url: txUrl(sig) };
}

/** Owner-signed grant: fund the session key with exactly the cap and write the
 *  open receipt in the same transaction. */
export async function openSession(c, owner, agentPubkey, capLamports, ttlSeconds, label) {
  const receipt = {
    p: "mitt/1", t: "open",
    s: sessionIdFor(agentPubkey.toBase58()),
    a: agentPubkey.toBase58(),
    c: capLamports,
    x: Math.floor(Date.now() / 1000) + ttlSeconds,
    ...(label ? { n: String(label).slice(0, 48) } : {}),
  };
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: owner.publicKey, blockhash, lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));
  tx.add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: agentPubkey, lamports: capLamports }));
  tx.add(memoIx(JSON.stringify(receipt), owner.publicKey));

  const sim = await c.simulateTransaction(tx);
  if (sim.value.err) throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);

  tx.sign(owner);
  const started = Date.now();
  const sig = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const res = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`Grant failed on chain: ${JSON.stringify(res.value.err)}`);
  return { signature: sig, ms: Date.now() - started, url: txUrl(sig) };
}

/** Agent-signed revoke: sweep the remainder home and close the session. The fee is
 *  priced from the real compiled message, never assumed. */
export async function closeSession(c, agent, ownerPubkey, reason = "revoked") {
  const owner = new PublicKey(ownerPubkey);
  const balance = await c.getBalance(agent.publicKey);
  const receipt = { p: "mitt/1", t: "close", s: sessionIdFor(agent.publicKey.toBase58()), r: String(reason).slice(0, 32) };
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");

  const assemble = (sweep) => {
    const tx = new Transaction({ feePayer: agent.publicKey, blockhash, lastValidBlockHeight });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));
    tx.add(memoIx(JSON.stringify(receipt), agent.publicKey));
    if (sweep > 0) tx.add(SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: owner, lamports: sweep }));
    return tx;
  };

  let fee = 5000;
  try {
    const priced = await c.getFeeForMessage(assemble(Math.max(0, balance - 5000)).compileMessage());
    if (typeof priced.value === "number" && priced.value > 0) fee = priced.value;
  } catch { /* fall back to the default and let simulation catch a shortfall */ }

  const tx = assemble(balance > fee ? balance - fee : 0);
  const sim = await c.simulateTransaction(tx);
  if (sim.value.err) throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);

  tx.sign(agent);
  const started = Date.now();
  const sig = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const res = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`Revoke failed on chain: ${JSON.stringify(res.value.err)}`);
  return { signature: sig, ms: Date.now() - started, url: txUrl(sig), swept: balance > fee ? balance - fee : 0, fee };
}
