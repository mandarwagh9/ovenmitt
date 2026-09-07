#!/usr/bin/env node
/** Runs the whole Oven Mitt lifecycle against Cookie Chain mainnet and prints the
 *  three explorer links the bounty submission needs.
 *
 *  It uses a throwaway demo wallet stored in .demo-owner.json (gitignored) rather
 *  than your real wallet, so no private key of yours is ever exported to disk.
 *  Run it once with no funds to get an address, ask the sponsor to send COOK to
 *  that address, then run it again.
 *
 *    node scripts/demo.mjs            # print the demo wallet and what it needs
 *    node scripts/demo.mjs --run      # grant, spend, revoke, print proof
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
  closeSession, conn, fmtCook, LAMPORTS_PER_COOK, openSession, readSession, RPC, spend,
} from "../mcp/mitt-core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEYFILE = path.join(HERE, "..", ".demo-owner.json");

const CAP = 0.02;            // COOK handed to the agent
const AGENT_SPEND = 0.005;   // COOK the agent spends under the cap
const HEADROOM = 0.004;      // rough allowance for the three signatures

function loadOwner() {
  if (fs.existsSync(KEYFILE)) {
    const { secret } = JSON.parse(fs.readFileSync(KEYFILE, "utf8"));
    return Keypair.fromSecretKey(bs58.decode(secret));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(KEYFILE, JSON.stringify({ secret: bs58.encode(kp.secretKey) }, null, 2));
  return kp;
}

const line = (s = "") => console.log(s);

const owner = loadOwner();
const c = conn();
const needed = CAP + HEADROOM;
const balance = await c.getBalance(owner.publicKey);

line();
line("Oven Mitt lifecycle demo");
line(`  rpc      ${RPC}`);
line(`  wallet   ${owner.publicKey.toBase58()}`);
line(`  balance  ${fmtCook(balance)} COOK`);
line(`  needs    ${needed} COOK`);
line();

if (balance < needed * LAMPORTS_PER_COOK) {
  line("Not funded yet. Ask the Cookie Chain sponsor to send a little COOK to:");
  line();
  line(`    ${owner.publicKey.toBase58()}`);
  line();
  line(`Roughly ${needed} COOK covers the grant, one agent spend and the revoke.`);
  line("This is a throwaway wallet created for the demo. Your real wallet is untouched.");
  line("Then run:  node scripts/demo.mjs --run");
  line();
  process.exit(0);
}

if (!process.argv.includes("--run")) {
  line("Funded. Run with --run to execute grant, spend and revoke on mainnet.");
  line();
  process.exit(0);
}

const agent = Keypair.generate();
line(`Agent session key: ${agent.publicKey.toBase58()}`);
line();

try {
  line(`1/3  Granting ${CAP} COOK ...`);
  const g = await openSession(c, owner, agent.publicKey, Math.floor(CAP * LAMPORTS_PER_COOK), 3600, "demo agent");
  line(`     confirmed in ${g.ms} ms`);
  line(`     ${g.url}`);
  line();

  line(`2/3  Agent spending ${AGENT_SPEND} COOK under the cap ...`);
  const s = await spend(
    c, agent, owner.publicKey.toBase58(),
    Math.floor(AGENT_SPEND * LAMPORTS_PER_COOK),
    "transfer", `demo spend of ${AGENT_SPEND} COOK`,
  );
  line(`     confirmed in ${s.ms} ms`);
  line(`     ${s.url}`);
  line();

  line("     checking the cap actually bites ...");
  try {
    await spend(c, agent, owner.publicKey.toBase58(), Math.floor(999 * LAMPORTS_PER_COOK), "transfer", "should be refused");
    line("     WARNING: an over-cap spend was NOT refused. That is a bug.");
  } catch (e) {
    line(`     refused, as it should be: ${e.message.split(".")[0]}.`);
  }
  line();

  line("3/3  Revoking and sweeping ...");
  const r = await closeSession(c, agent, owner.publicKey.toBase58(), "revoked");
  line(`     confirmed in ${r.ms} ms, swept ${fmtCook(r.swept)} COOK back (fee ${r.fee})`);
  line(`     ${r.url}`);
  line();

  const final = await readSession(c, agent.publicKey.toBase58());
  line("Final on-chain state");
  line(`  cap        ${fmtCook(final.cap)} COOK`);
  line(`  spent      ${fmtCook(final.spent)} COOK`);
  line(`  left in    ${fmtCook(final.balance)} COOK`);
  line(`  status     ${final.closed ? `revoked (${final.closeReason})` : "active"}`);
  line(`  receipts   ${final.entries.length}`);
  line();
  line("Paste these three into the submission:");
  line(`  grant   ${g.url}`);
  line(`  spend   ${s.url}`);
  line(`  revoke  ${r.url}`);
  line(`  session ${agent.publicKey.toBase58()}`);
  line();
} catch (e) {
  line();
  line(`FAILED: ${e.message}`);
  line();
  line("The session key, if it was funded, still holds its cap. Recover it with the");
  line("secret printed below and mitt_spend, or just leave it: it is capped by design.");
  line(`  agent secret: ${bs58.encode(agent.secretKey)}`);
  line();
  process.exit(1);
}
