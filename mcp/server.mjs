#!/usr/bin/env node
/** Oven Mitt MCP server.
 *
 *  Gives any MCP agent (Claude Code, Claude Desktop, Cursor) the ability to spend
 *  on Cookie Chain under a leash a human granted in the browser. The agent holds
 *  only a session key funded with a fixed cap, so the worst case is bounded by the
 *  chain rather than by this server behaving well.
 *
 *  Runs locally over stdio and signs on your machine. Read-only tools need no key.
 *
 *  This composes with cookie-mcp: give that server a mitt session key instead of
 *  your real one and its blast radius becomes a number you chose. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import {
  agentFromEnv, conn, fmtCook, LAMPORTS_PER_COOK, readSession, spend, txUrl, RPC,
} from "./mitt-core.mjs";

const server = new McpServer({ name: "ovenmitt", version: "0.1.0" });

const ok = (text) => ({ content: [{ type: "text", text }] });
const fail = (e) => ({
  content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

server.registerTool(
  "mitt_status",
  {
    title: "Read the leash",
    description:
      "Report the current Oven Mitt session: its cap, how much is spent, what remains, " +
      "whether it has expired or been revoked. Call this before spending. Needs no key " +
      "if an agent pubkey is supplied.",
    inputSchema: { agent: z.string().optional().describe("Session pubkey. Defaults to MITT_SESSION_KEY.") },
  },
  async ({ agent }) => {
    try {
      const pubkey = agent ?? agentFromEnv().publicKey.toBase58();
      new PublicKey(pubkey);
      const s = await readSession(conn(), pubkey);
      if (!s.cap && !s.entries.length) {
        return ok(`No Oven Mitt session found for ${pubkey}. Grant one at https://mitt-cookiechain.vercel.app`);
      }
      return ok(
        [
          `Session ${s.sid}${s.label ? ` (${s.label})` : ""}`,
          `  agent      ${s.agent}`,
          `  cap        ${fmtCook(s.cap)} COOK`,
          `  spent      ${fmtCook(s.spent)} COOK`,
          `  remaining  ${fmtCook(s.remaining)} COOK`,
          `  on hand    ${fmtCook(s.balance)} COOK`,
          `  status     ${s.closed ? `revoked (${s.closeReason})` : s.expired ? "past its stated expiry" : "active"}`,
          `  receipts   ${s.entries.length}`,
          "",
          "The cap is enforced by the chain: this key cannot spend what it does not hold.",
        ].join("\n"),
      );
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "mitt_spend",
  {
    title: "Spend under the leash",
    description:
      "Transfer COOK from the session wallet, writing an on-chain receipt in the same " +
      "transaction. Simulated before sending. Fails if the amount exceeds what the " +
      "session holds, which is the cap doing its job.",
    inputSchema: {
      to: z.string().describe("Recipient address on Cookie Chain."),
      amount: z.number().positive().describe("Amount in COOK, for example 0.01."),
      reason: z.string().max(120).describe("Short human-readable reason, written into the receipt."),
      kind: z.string().max(24).optional().describe("Action kind. Defaults to 'transfer'."),
    },
  },
  async ({ to, amount, reason, kind }) => {
    try {
      const agent = agentFromEnv();
      const c = conn();
      const s = await readSession(c, agent.publicKey.toBase58());
      if (s.closed) return fail(new Error(`This session was revoked (${s.closeReason}). It cannot spend.`));

      const lamports = Math.floor(amount * LAMPORTS_PER_COOK);
      const r = await spend(c, agent, to, lamports, kind ?? "transfer", reason);
      return ok(
        [
          `Sent ${fmtCook(lamports)} COOK to ${to}`,
          `  reason    ${reason}`,
          `  confirmed in ${r.ms} ms`,
          `  ${r.url}`,
          "",
          `Remaining under the cap: ${fmtCook(Math.max(0, s.remaining - lamports))} COOK`,
        ].join("\n"),
      );
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "mitt_history",
  {
    title: "Read the audit trail",
    description:
      "List every receipt this session has written to Cookie Chain, newest last. Each " +
      "receipt shares a transaction with the value it describes, so the log cannot drift " +
      "from the money.",
    inputSchema: {
      agent: z.string().optional().describe("Session pubkey. Defaults to MITT_SESSION_KEY."),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ agent, limit }) => {
    try {
      const pubkey = agent ?? agentFromEnv().publicKey.toBase58();
      const s = await readSession(conn(), pubkey);
      if (!s.entries.length) return ok(`No receipts yet for session ${s.sid}.`);
      const rows = s.entries.slice(-(limit ?? 25)).map((e) => {
        const when = e.blockTime ? new Date(e.blockTime * 1000).toISOString().replace("T", " ").slice(0, 19) : "pending";
        const what =
          e.receipt.t === "open" ? `granted ${fmtCook(e.receipt.c)} COOK`
          : e.receipt.t === "close" ? `revoked (${e.receipt.r ?? "closed"})`
          : e.receipt.m ?? e.receipt.k;
        const amt = e.delta ? ` [${e.delta > 0 ? "+" : ""}${fmtCook(e.delta)}]` : "";
        return `${when}  ${e.receipt.t.padEnd(5)} ${what}${amt}${e.err ? "  (failed)" : ""}\n    ${txUrl(e.sig)}`;
      });
      return ok([`Session ${s.sid}, ${s.entries.length} receipts on Cookie Chain:`, "", ...rows].join("\n"));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "mitt_chain_info",
  {
    title: "Cookie Chain health",
    description: "Current slot, chain version and per-transaction fee. Needs no key.",
    inputSchema: {},
  },
  async () => {
    try {
      const c = conn();
      const [v, slot, bh] = await Promise.all([c.getVersion(), c.getSlot(), c.getLatestBlockhash("confirmed")]);
      return ok(
        [
          `Cookie Chain (${RPC})`,
          `  solana-core  ${v["solana-core"]}`,
          `  slot         ${slot.toLocaleString("en-US")}`,
          `  blockhash    ${bh.blockhash}`,
          `  base fee     0.000005 COOK per signature`,
        ].join("\n"),
      );
    } catch (e) { return fail(e); }
  },
);

await server.connect(new StdioServerTransport());
