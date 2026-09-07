import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { MEMO_PROGRAM_ID } from "./chain";
import { encodeReceipt, sessionIdFor, type ActReceipt, type CloseReceipt, type OpenReceipt } from "./receipts";

export interface SessionPolicy {
  capLamports: number;   // hard cap: the session key is funded with exactly this
  ttlSeconds: number;    // advisory expiry, written into the open receipt
  label?: string;
}

export function memoIx(text: string, signer: PublicKey) {
  return new TransactionInstruction({
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(text, "utf8"),
  });
}

export function newSessionKeypair() {
  return Keypair.generate();
}

/** Owner-signed. Funds the agent key with exactly `capLamports` and writes the
 *  open receipt in the SAME transaction, so the grant and its audit record are atomic. */
export async function buildOpenSessionTx(
  c: Connection, owner: PublicKey, agent: PublicKey, policy: SessionPolicy,
): Promise<Transaction> {
  const receipt: OpenReceipt = {
    p: "mitt/1", t: "open",
    s: sessionIdFor(agent.toBase58()),
    a: agent.toBase58(),
    c: policy.capLamports,
    x: Math.floor(Date.now() / 1000) + policy.ttlSeconds,
    ...(policy.label ? { n: policy.label.slice(0, 48) } : {}),
  };
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));
  tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: agent, lamports: policy.capLamports }));
  tx.add(memoIx(encodeReceipt(receipt), owner));
  return tx;
}

/** Agent-signed. A spend plus its receipt, atomically. */
export async function buildAgentActionTx(
  c: Connection, agent: PublicKey, to: PublicKey, lamports: number, kind: string, detail?: string,
): Promise<Transaction> {
  const receipt: ActReceipt = {
    p: "mitt/1", t: "act",
    s: sessionIdFor(agent.toBase58()),
    k: kind.slice(0, 24),
    ...(detail ? { m: detail.slice(0, 120) } : {}),
  };
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: agent, blockhash, lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));
  if (lamports > 0) tx.add(SystemProgram.transfer({ fromPubkey: agent, toPubkey: to, lamports }));
  tx.add(memoIx(encodeReceipt(receipt), agent));
  return tx;
}

/** Agent-signed sweep: returns every remaining lamport (minus fee) to the owner
 *  and writes the close receipt. This is what "revoke" actually executes. */
export async function buildCloseSessionTx(
  c: Connection, agent: PublicKey, owner: PublicKey, reason: string, balance: number,
): Promise<Transaction | null> {
  const receipt: CloseReceipt = { p: "mitt/1", t: "close", s: sessionIdFor(agent.toBase58()), r: reason.slice(0, 32) };
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: agent, blockhash, lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));
  tx.add(memoIx(encodeReceipt(receipt), agent));
  const fee = 5000;
  const sweep = balance - fee;
  if (sweep > 0) tx.add(SystemProgram.transfer({ fromPubkey: agent, toPubkey: owner, lamports: sweep }));
  return tx;
}
