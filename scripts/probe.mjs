import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram
} from "@solana/web3.js";

const RPC = "https://rpc.cookiescan.io";
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const c = new Connection(RPC, "confirmed");

const owner = new PublicKey("6pN65FYnzkvfURxFWFJzuerqhT7CWo5CSk7TL5rYESDD");

console.log("== chain identity ==");
console.log("version   ", JSON.stringify(await c.getVersion()));
console.log("genesis   ", await c.getGenesisHash());
console.log("slot      ", await c.getSlot());

const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash();
console.log("blockhash ", blockhash, "validTil", lastValidBlockHeight);

// Build a realistic session-receipt tx: memo + tiny transfer, simulate it (no funds needed)
const session = Keypair.generate();
console.log("\n== ephemeral agent session key ==");
console.log("session pubkey", session.publicKey.toBase58());

const receipt = JSON.stringify({ v: 1, k: "session.open", sid: "demo", cap: 0.25, exp: 3600 });
const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 }));
tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: session.publicKey, lamports: 1000 }));
tx.add(new TransactionInstruction({ keys: [{ pubkey: owner, isSigner: true, isWritable: false }], programId: MEMO_PROGRAM, data: Buffer.from(receipt, "utf8") }));

console.log("\n== simulate (unfunded owner, expect insufficient-funds not program error) ==");
const sim = await c.simulateTransaction(tx, undefined, [owner]);
console.log("err  ", JSON.stringify(sim.value.err));
console.log("units", sim.value.unitsConsumed);
console.log("logs :"); (sim.value.logs || []).forEach(l => console.log("   ", l));

console.log("\n== fee for that message ==");
try {
  const fee = await c.getFeeForMessage(tx.compileMessage());
  console.log("lamports", fee.value, "=", (fee.value ?? 0) / LAMPORTS_PER_SOL, "COOK");
} catch (e) { console.log("fee err", e.message); }

console.log("\n== does the chain expose SPL token program accounts? ==");
for (const pid of [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
]) {
  const ai = await c.getAccountInfo(new PublicKey(pid));
  console.log(pid, ai ? `present executable=${ai.executable} owner=${ai.owner.toBase58().slice(0,12)}` : "MISSING");
}
