import { Connection, PublicKey } from "@solana/web3.js";

/** Cookie Chain is an independent SVM network. Standard Solana SDKs work by
 *  pointing at its RPC — the wallet only ever *signs*; we broadcast ourselves.
 *  That is what makes a Solana-only wallet (Nightly) usable on a non-Solana SVM. */
export const RPC_HTTP = process.env.NEXT_PUBLIC_COOKIE_RPC ?? "https://rpc.cookiescan.io";
export const RPC_WSS = process.env.NEXT_PUBLIC_COOKIE_WSS ?? "wss://wss.cookiescan.io";

export const COOKIE_GENESIS = "9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZB9o2EoEcBB2";
export const EXPLORER = "https://cookiescan.io";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export const COOK_DECIMALS = 9;
export const LAMPORTS_PER_COOK = 1_000_000_000;

let _conn: Connection | null = null;
export function conn(): Connection {
  if (!_conn) _conn = new Connection(RPC_HTTP, { commitment: "confirmed", wsEndpoint: RPC_WSS });
  return _conn;
}

export const txUrl = (sig: string) => `${EXPLORER}/tx/${sig}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;

export const fmtCook = (lamports: number, dp = 4) =>
  (lamports / LAMPORTS_PER_COOK).toLocaleString(undefined, { maximumFractionDigits: dp });

export const shortAddr = (a: string, n = 4) =>
  a.length <= n * 2 + 3 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
