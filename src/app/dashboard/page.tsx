"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import {
  ArrowSquareOut, Copy, Cube, Plugs, Prohibit, Robot, Warning, Check,
} from "@phosphor-icons/react";
import { conn, fmtCook, LAMPORTS_PER_COOK, shortAddr, txUrl, addrUrl } from "@/lib/chain";
import { buildAgentActionTx, buildCloseSessionTx, buildOpenSessionTx } from "@/lib/session";
import { loadOwnerSessions, loadSession, type SessionView } from "@/lib/indexer";
import { getAnyProvider, NIGHTLY_INSTALL, type SvmProvider } from "@/lib/wallet";

const LS_KEYS = "ovenmitt.sessionKeys.v1";

type Phase = "idle" | "building" | "signing" | "sending" | "confirming" | "done" | "error";

interface TxState {
  phase: Phase;
  message?: string;
  signature?: string;
  ms?: number;
}

/** Session secret keys live in this browser only. They are throwaway keys that
 *  hold at most the cap the user funded, and they exist to be handed to an agent. */
function loadKeys(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_KEYS) ?? "{}"); } catch { return {}; }
}
function saveKey(pub: string, secret: string) {
  try {
    const all = loadKeys();
    all[pub] = secret;
    localStorage.setItem(LS_KEYS, JSON.stringify(all));
  } catch { /* private mode: session still works this page load */ }
}

export default function Dashboard() {
  const [provider, setProvider] = useState<SvmProvider | null>(null);
  const [walletName, setWalletName] = useState("Nightly");
  const [owner, setOwner] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);

  const [agents, setAgents] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  const [loadingView, setLoadingView] = useState(false);

  const [cap, setCap] = useState("0.25");
  const [hours, setHours] = useState("6");
  const [label, setLabel] = useState("research bot");
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  const [copied, setCopied] = useState<string | null>(null);

  const keysRef = useRef<Record<string, string>>({});

  useEffect(() => {
    keysRef.current = loadKeys();
    const found = getAnyProvider();
    setHasWallet(!!found);
    if (found) { setProvider(found.provider); setWalletName(found.name); }
  }, []);

  const refreshBalance = useCallback(async (pk: string) => {
    try { setBalance(await conn().getBalance(new PublicKey(pk))); } catch { setBalance(null); }
  }, []);

  const refreshSessions = useCallback(async (pk: string) => {
    try {
      const list = await loadOwnerSessions(conn(), pk);
      setAgents(list);
      setActive((cur) => cur ?? list[0] ?? null);
    } catch { /* keep previous list on RPC hiccup */ }
  }, []);

  const connect = async () => {
    if (!provider) return;
    try {
      const res = await provider.connect();
      const pk = res.publicKey.toString();
      setOwner(pk);
      await Promise.all([refreshBalance(pk), refreshSessions(pk)]);
    } catch (e) {
      setTx({ phase: "error", message: e instanceof Error ? e.message : "Wallet refused the connection." });
    }
  };

  useEffect(() => {
    if (!active) { setView(null); return; }
    let alive = true;
    setLoadingView(true);
    loadSession(conn(), active)
      .then((v) => { if (alive) setView(v); })
      .catch(() => { if (alive) setView(null); })
      .finally(() => { if (alive) setLoadingView(false); });
    return () => { alive = false; };
  }, [active, tx.signature]);

  /** Sign with the connected wallet, then broadcast to Cookie Chain ourselves.
   *  The wallet is never asked to send, so it does not matter which cluster it
   *  is pointed at. */
  const signSendConfirm = async (t: Transaction, signWith: SvmProvider | Keypair) => {
    const c = conn();
    // Capture these before signing. A wallet returns a re-deserialized transaction,
    // so read the values off the object we built rather than trusting them to survive
    // the round trip, and fail loudly here instead of with a non-null assertion.
    const blockhash = t.recentBlockhash;
    const lastValidBlockHeight = t.lastValidBlockHeight;
    if (!blockhash || lastValidBlockHeight === undefined) {
      throw new Error("Transaction is missing its blockhash, so it cannot be confirmed.");
    }

    setTx({ phase: "signing" });
    let raw: Buffer;
    if (signWith instanceof Keypair) {
      t.sign(signWith);
      raw = t.serialize();
    } else {
      const signed = await signWith.signTransaction(t);
      raw = Buffer.from(signed.serialize());
    }
    setTx({ phase: "sending" });
    const started = performance.now();
    const sig = await c.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
    setTx({ phase: "confirming", signature: sig });
    const res = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    const ms = Math.round(performance.now() - started);
    if (res.value.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(res.value.err)}`);
    setTx({ phase: "done", signature: sig, ms });
    return sig;
  };

  const openSession = async () => {
    if (!provider || !owner) return;
    const capLamports = Math.floor(Number(cap) * LAMPORTS_PER_COOK);
    const ttl = Math.floor(Number(hours) * 3600);
    if (!Number.isFinite(capLamports) || capLamports <= 0) {
      setTx({ phase: "error", message: "Enter a cap greater than zero." });
      return;
    }
    try {
      setTx({ phase: "building" });
      const agent = Keypair.generate();
      const t = await buildOpenSessionTx(conn(), new PublicKey(owner), agent.publicKey, {
        capLamports, ttlSeconds: ttl, label,
      });
      // Simulate before asking the user to sign, so a doomed transaction never
      // reaches the wallet prompt.
      const sim = await conn().simulateTransaction(t);
      if (sim.value.err) {
        throw new Error(
          `Simulation failed: ${JSON.stringify(sim.value.err)}. ` +
          `Your wallet needs at least ${fmtCook(capLamports)} COOK plus fees.`,
        );
      }
      saveKey(agent.publicKey.toBase58(), bs58.encode(agent.secretKey));
      keysRef.current = loadKeys();
      await signSendConfirm(t, provider);
      setActive(agent.publicKey.toBase58());
      await Promise.all([refreshBalance(owner), refreshSessions(owner)]);
    } catch (e) {
      setTx({ phase: "error", message: e instanceof Error ? e.message : "Could not open the session." });
    }
  };

  const agentSpend = async () => {
    if (!view || !owner) return;
    const secret = keysRef.current[view.agent];
    if (!secret) {
      setTx({ phase: "error", message: "This session key is not in this browser, so its agent cannot act from here." });
      return;
    }
    try {
      setTx({ phase: "building" });
      const kp = Keypair.fromSecretKey(bs58.decode(secret));
      // Read the balance fresh. view.balance comes from the indexer poll and can be
      // stale, which would build a transfer the session cannot actually cover.
      const live = await conn().getBalance(kp.publicKey);
      const amount = Math.min(Math.floor(0.01 * LAMPORTS_PER_COOK), Math.max(0, live - 10000));
      if (amount <= 0) throw new Error("This session has no spendable balance left.");
      const t = await buildAgentActionTx(
        conn(), kp.publicKey, new PublicKey(owner), amount, "transfer",
        `returned ${fmtCook(amount)} COOK to owner`,
      );
      await signSendConfirm(t, kp);
      await refreshBalance(owner);
    } catch (e) {
      setTx({ phase: "error", message: e instanceof Error ? e.message : "The agent action failed." });
    }
  };

  const revoke = async () => {
    if (!view || !owner) return;
    const secret = keysRef.current[view.agent];
    if (!secret) {
      setTx({ phase: "error", message: "Revoke needs the session key, which is not stored in this browser." });
      return;
    }
    try {
      setTx({ phase: "building" });
      const kp = Keypair.fromSecretKey(bs58.decode(secret));
      const bal = await conn().getBalance(kp.publicKey);
      const t = await buildCloseSessionTx(conn(), kp.publicKey, new PublicKey(owner), "revoked", bal);
      if (!t) throw new Error("Nothing left to sweep.");
      await signSendConfirm(t, kp);
      await Promise.all([refreshBalance(owner), refreshSessions(owner)]);
    } catch (e) {
      setTx({ phase: "error", message: e instanceof Error ? e.message : "Revoke failed." });
    }
  };

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(null), 1400);
    } catch { /* clipboard blocked */ }
  };

  const remaining = view ? Math.max(0, view.cap - view.spent) : 0;
  const pctSpent = view && view.cap > 0 ? Math.min(100, (view.spent / view.cap) * 100) : 0;
  const busy = ["building", "signing", "sending", "confirming"].includes(tx.phase);

  const expiry = useMemo(() => {
    if (!view?.expiresAt) return null;
    const left = view.expiresAt * 1000 - Date.now();
    if (left <= 0) return "expired";
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  }, [view]);

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-40 h-16 border-b border-line-soft bg-base/85 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="text-accent"><Cube size={19} weight="duotone" /></span>
            <span className="text-[15px] font-semibold tracking-tight">Oven Mitt</span>
          </Link>
          {owner ? (
            <div className="flex items-center gap-3">
              <span className="num hidden text-[13px] text-ink-2 sm:inline">
                {balance === null ? "balance unavailable" : `${fmtCook(balance)} COOK`}
              </span>
              <a
                href={addrUrl(owner)}
                target="_blank"
                rel="noreferrer noopener"
                className="num flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-[13px] text-ink transition-colors hover:border-ink-3"
              >
                {shortAddr(owner, 4)}
                <span className="text-ink-3"><ArrowSquareOut size={12} /></span>
              </a>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={!provider}
              className="flex items-center gap-2 rounded-[10px] bg-accent px-4 py-2 text-[13.5px] font-medium text-[#16110a] transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              <Plugs size={16} weight="bold" /> Connect {walletName}
            </button>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-12">
        {hasWallet === false && (
          <div className="mb-10 flex flex-wrap items-center gap-4 rounded-[14px] border border-line bg-surface p-6">
            <span className="text-accent"><Warning size={22} weight="duotone" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold">No SVM wallet detected</h2>
              <p className="mt-1 text-[14px] text-ink-2">
                Oven Mitt targets Nightly, which supports Cookie Chain accounts. Install it, then reload this page.
              </p>
            </div>
            <a
              href={NIGHTLY_INSTALL}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-[10px] bg-accent px-4 py-2.5 text-[13.5px] font-medium text-[#16110a]"
            >
              Install Nightly
            </a>
          </div>
        )}

        {!owner ? (
          <div className="py-24 text-center">
            <span className="mx-auto mb-5 block w-fit text-ink-3"><Robot size={34} weight="duotone" /></span>
            <h1 className="text-[1.8rem] font-semibold tracking-tight">Connect a wallet to begin</h1>
            <p className="mx-auto mt-3 max-w-[46ch] text-[15px] leading-relaxed text-ink-2">
              Your wallet signs the grant. It never signs anything the agent does, and its key is never shared.
            </p>
            {provider && (
              <button
                onClick={connect}
                className="mt-8 rounded-[10px] bg-accent px-5 py-3 text-[14.5px] font-medium text-[#16110a] transition-transform active:translate-y-px"
              >
                Connect {walletName}
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[22rem_1fr] lg:gap-10">
            {/* Grant panel */}
            <section>
              <h2 className="text-[1.05rem] font-semibold tracking-tight">Open a session</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
                A new keypair is funded with exactly this cap. That funding is the enforcement.
              </p>

              <div className="mt-6 space-y-5">
                <div className="flex flex-col gap-2">
                  <label htmlFor="cap" className="text-[13px] text-ink-2">Spend cap</label>
                  <div className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 focus-within:border-accent-dim">
                    <input
                      id="cap" value={cap} onChange={(e) => setCap(e.target.value)}
                      inputMode="decimal"
                      className="num w-full bg-transparent py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-3"
                    />
                    <span className="num text-[13px] text-ink-3">COOK</span>
                  </div>
                  <p className="text-[12.5px] text-ink-3">The most this agent can ever spend.</p>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="ttl" className="text-[13px] text-ink-2">Expires in</label>
                  <div className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 focus-within:border-accent-dim">
                    <input
                      id="ttl" value={hours} onChange={(e) => setHours(e.target.value)}
                      inputMode="decimal"
                      className="num w-full bg-transparent py-2.5 text-[14px] text-ink outline-none"
                    />
                    <span className="num text-[13px] text-ink-3">hours</span>
                  </div>
                  <p className="text-[12.5px] text-ink-3">Recorded in the receipt. Advisory, not enforced.</p>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="label" className="text-[13px] text-ink-2">Label</label>
                  <input
                    id="label" value={label} onChange={(e) => setLabel(e.target.value)}
                    className="rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[14px] text-ink outline-none focus:border-accent-dim"
                  />
                </div>

                <button
                  onClick={openSession}
                  disabled={busy}
                  className="w-full rounded-[10px] bg-accent px-4 py-3 text-[14px] font-medium text-[#16110a] transition-transform active:translate-y-px disabled:opacity-50"
                >
                  {busy ? "Working" : "Grant the session"}
                </button>
              </div>

              {tx.phase !== "idle" && (
                <div
                  className={`mt-5 rounded-[14px] border p-4 ${
                    tx.phase === "error" ? "border-bad/40 bg-bad/5" : "border-line bg-surface"
                  }`}
                >
                  {tx.phase === "error" ? (
                    <>
                      <p className="text-[13.5px] font-medium text-bad">That did not go through</p>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{tx.message}</p>
                    </>
                  ) : tx.phase === "done" ? (
                    <>
                      <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-ok">
                        <Check size={15} weight="bold" /> Confirmed in {tx.ms} ms
                      </p>
                      <a
                        href={txUrl(tx.signature!)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="num mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-2 hover:text-ink"
                      >
                        {shortAddr(tx.signature!, 8)} <ArrowSquareOut size={12} />
                      </a>
                    </>
                  ) : (
                    <p className="text-[13.5px] text-ink-2">
                      {tx.phase === "building" && "Building and simulating"}
                      {tx.phase === "signing" && "Waiting for your wallet"}
                      {tx.phase === "sending" && "Broadcasting to Cookie Chain"}
                      {tx.phase === "confirming" && "Waiting for confirmation"}
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Session detail */}
            <section className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[1.05rem] font-semibold tracking-tight">
                  Sessions <span className="num text-ink-3">{agents.length}</span>
                </h2>
                {agents.length > 1 && (
                  <select
                    value={active ?? ""}
                    onChange={(e) => setActive(e.target.value)}
                    className="num rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none"
                  >
                    {agents.map((a) => (
                      <option key={a} value={a}>{shortAddr(a, 6)}</option>
                    ))}
                  </select>
                )}
              </div>

              {agents.length === 0 && !loadingView && (
                <div className="mt-6 rounded-[14px] border border-line bg-surface px-6 py-14 text-center">
                  <span className="mx-auto mb-3 block w-fit text-ink-3"><Robot size={26} weight="duotone" /></span>
                  <p className="text-[14px] text-ink-2">No sessions yet.</p>
                  <p className="mt-1 text-[13px] text-ink-3">
                    Grant one on the left and it will appear here, read back off the chain.
                  </p>
                </div>
              )}

              {loadingView && (
                <div className="mt-6 animate-pulse space-y-3">
                  <div className="h-28 rounded-[14px] bg-surface" />
                  <div className="h-40 rounded-[14px] bg-surface" />
                </div>
              )}

              {view && !loadingView && (
                <div className="mt-6 space-y-5">
                  <div className="rounded-[14px] border border-line bg-surface p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[13px] text-ink-2">{view.open?.n ?? "Agent session"}</p>
                        <a
                          href={addrUrl(view.agent)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="num mt-1 flex items-center gap-1.5 text-[15px] text-ink hover:text-accent"
                        >
                          {shortAddr(view.agent, 8)} <ArrowSquareOut size={13} />
                        </a>
                      </div>
                      <div className="text-right">
                        <p className="num text-[1.35rem] font-semibold">{fmtCook(remaining)}</p>
                        <p className="text-[12.5px] text-ink-3">
                          of {fmtCook(view.cap)} COOK left
                        </p>
                      </div>
                    </div>

                    {/* Spend against cap. No filled background track, just the bar. */}
                    <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-500"
                        style={{ width: `${pctSpent}%` }}
                      />
                    </div>
                    <div className="mt-2.5 flex flex-wrap justify-between gap-2 text-[12.5px] text-ink-3">
                      <span className="num">{fmtCook(view.spent)} COOK spent</span>
                      <span>{view.closed ? `closed (${view.closeReason})` : expiry ?? ""}</span>
                    </div>

                    {!view.closed && (
                      <div className="mt-6 flex flex-wrap gap-3">
                        <button
                          onClick={agentSpend}
                          disabled={busy}
                          className="flex items-center gap-2 rounded-[10px] border border-line px-4 py-2.5 text-[13.5px] text-ink transition-colors hover:border-ink-3 disabled:opacity-50"
                        >
                          <Robot size={16} /> Run an agent action
                        </button>
                        <button
                          onClick={revoke}
                          disabled={busy}
                          className="flex items-center gap-2 rounded-[10px] border border-bad/40 px-4 py-2.5 text-[13.5px] text-bad transition-colors hover:bg-bad/5 disabled:opacity-50"
                        >
                          <Prohibit size={16} /> Revoke and sweep
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Handing the key to a real agent */}
                  {keysRef.current[view.agent] && !view.closed && (
                    <div className="rounded-[14px] border border-line bg-surface p-6">
                      <h3 className="text-[14px] font-semibold">Give this to your agent</h3>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                        This key can spend up to the cap and nothing more. It is stored only in this browser.
                      </p>
                      <button
                        onClick={() => copy(keysRef.current[view.agent], "secret")}
                        className="num mt-4 flex w-full items-center justify-between gap-3 rounded-[10px] border border-line bg-base px-3 py-2.5 text-left text-[12px] text-ink-2 transition-colors hover:border-ink-3"
                      >
                        <span className="truncate">
                          {shortAddr(keysRef.current[view.agent], 14)}
                        </span>
                        <span className="shrink-0 text-ink-3">
                          {copied === "secret" ? <Check size={14} weight="bold" /> : <Copy size={14} />}
                        </span>
                      </button>
                    </div>
                  )}

                  {/* Activity, read from chain */}
                  <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
                    <div className="border-b border-line-soft px-5 py-3.5">
                      <h3 className="text-[14px] font-semibold">On-chain activity</h3>
                    </div>
                    {view.entries.length === 0 ? (
                      <p className="px-5 py-10 text-center text-[13px] text-ink-3">
                        Nothing recorded for this session yet.
                      </p>
                    ) : (
                      <div className="divide-y divide-line-soft">
                        {[...view.entries].reverse().map((e) => (
                          <a
                            key={e.sig + e.receipt.t}
                            href={txUrl(e.sig)}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2"
                          >
                            <span className="num w-16 shrink-0 text-[12px] text-accent">
                              {e.receipt.t}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                              {e.receipt.t === "act" && "m" in e.receipt && e.receipt.m
                                ? e.receipt.m
                                : e.receipt.t === "open"
                                  ? `funded with ${fmtCook(view.cap)} COOK`
                                  : `closed (${"r" in e.receipt ? e.receipt.r : "closed"})`}
                            </span>
                            {e.delta !== 0 && (
                              <span className={`num shrink-0 text-[12.5px] ${e.delta > 0 ? "text-ok" : "text-ink-3"}`}>
                                {e.delta > 0 ? "+" : ""}{fmtCook(e.delta)}
                              </span>
                            )}
                            <span className="shrink-0 text-ink-3"><ArrowSquareOut size={12} /></span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
