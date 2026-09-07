"use client";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowSquareOut, Pulse } from "@phosphor-icons/react";
import type { Entry } from "@/lib/indexer";
import { txUrl, shortAddr } from "@/lib/chain";

interface Feed { ok: boolean; slot: number; entries: Entry[]; error?: string }

const KIND_LABEL: Record<string, string> = {
  open: "granted", act: "spent", close: "revoked",
};

export function LiveChain() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [failed, setFailed] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/feed", { cache: "no-store" });
        const j: Feed = await r.json();
        if (!alive) return;
        setFeed(j);
        setFailed(!j.ok);
      } catch {
        if (alive) setFailed(true);
      }
    };
    tick();
    const id = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="rounded-[14px] border border-line bg-surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="flex items-center gap-2 text-ink-2">
          {/* Real semantic state: this dot reflects live RPC reachability. */}
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${failed ? "bg-bad" : "bg-ok"}`}
          />
          <span className="text-[12.5px]">
            {failed ? "Cookie Chain RPC unreachable" : "Cookie Chain mainnet"}
          </span>
        </div>
        <span className="num text-[12.5px] text-ink-3">
          {feed?.slot ? `slot ${feed.slot.toLocaleString()}` : "connecting"}
        </span>
      </div>

      <div className="divide-y divide-line-soft">
        {feed === null && (
          <div className="animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <div className="h-3 w-16 rounded bg-line" />
                <div className="h-3 flex-1 rounded bg-line-soft" />
                <div className="h-3 w-12 rounded bg-line-soft" />
              </div>
            ))}
          </div>
        )}

        {feed?.entries.length === 0 && (
          <div className="px-4 py-8 text-center">
            <span className="mx-auto mb-2.5 block w-fit text-ink-3"><Pulse size={20} /></span>
            <p className="text-[13px] text-ink-2">No receipts written yet.</p>
            <p className="mt-1 text-[12.5px] text-ink-3">
              The first session opened on this chain will appear here.
            </p>
          </div>
        )}

        {feed?.entries.map((e, i) => (
          <motion.a
            key={e.sig}
            href={txUrl(e.sig)}
            target="_blank"
            rel="noreferrer noopener"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: Math.min(i * 0.04, 0.3) }}
            className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2"
          >
            <span className="num w-16 shrink-0 text-[12px] text-accent">
              {KIND_LABEL[e.receipt.t] ?? e.receipt.t}
            </span>
            <span className="num min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
              {e.receipt.t === "act" && "m" in e.receipt && e.receipt.m
                ? e.receipt.m
                : `session ${e.receipt.s}`}
            </span>
            <span className="num shrink-0 text-[12px] text-ink-3">
              {shortAddr(e.sig, 4)}
            </span>
            <span className="shrink-0 text-ink-3"><ArrowSquareOut size={13} /></span>
          </motion.a>
        ))}
      </div>
    </div>
  );
}
