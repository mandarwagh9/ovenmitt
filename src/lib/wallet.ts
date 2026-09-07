"use client";
import { PublicKey, Transaction } from "@solana/web3.js";

/** Minimal surface we need from an injected SVM wallet. */
export interface SvmProvider {
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect?(): Promise<void>;
  signTransaction(tx: Transaction): Promise<Transaction>;
  signAllTransactions?(txs: Transaction[]): Promise<Transaction[]>;
}

type W = Window & {
  nightly?: { solana?: SvmProvider };
  solana?: SvmProvider & { isNightly?: boolean; isPhantom?: boolean };
};

export const NIGHTLY_INSTALL = "https://nightly.app/download";

/** Nightly is the wallet this app targets (required by the Cookie Chain bounty).
 *  We deliberately do NOT use the wallet's own `sendTransaction`: that would
 *  broadcast to whatever cluster the wallet is pointed at (Solana mainnet).
 *  We only ask it to SIGN, then we submit the signed bytes to the Cookie Chain
 *  RPC ourselves. Signatures are network-agnostic, so this works cleanly. */
export function getNightly(): SvmProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as W;
  if (w.nightly?.solana) return w.nightly.solana;
  if (w.solana?.isNightly) return w.solana;
  return null;
}

/** Any injected SVM wallet, Nightly preferred. */
export function getAnyProvider(): { provider: SvmProvider; name: string } | null {
  const n = getNightly();
  if (n) return { provider: n, name: "Nightly" };
  if (typeof window === "undefined") return null;
  const w = window as W;
  if (w.solana?.signTransaction) {
    return { provider: w.solana, name: w.solana.isPhantom ? "Phantom" : "Injected wallet" };
  }
  return null;
}

export async function waitForNightly(timeoutMs = 3000): Promise<SvmProvider | null> {
  const started = Date.now();
  for (;;) {
    const n = getNightly();
    if (n) return n;
    if (Date.now() - started > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 120));
  }
}

export const toPk = (v: { toString(): string }) => new PublicKey(v.toString());
