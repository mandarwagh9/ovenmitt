# Oven Mitt

**Capped, expiring, revocable wallets for AI agents on [Cookie Chain](https://www.cookiechain.wtf).**

Give an agent money without giving it your wallet. Oven Mitt mints a throwaway
session key, funds it with exactly the cap you choose, and writes an on-chain
receipt for every single thing that key does. When you want it to stop, one
click sweeps the remaining balance home and closes the session on chain.

Live app: <https://mitt-cookiechain.vercel.app>
Chain: Cookie Chain mainnet (`https://rpc.cookiescan.io`)

---

## Why this exists

The current way to let an AI agent transact is to hand it a private key. That
key can spend everything the wallet holds. The mitigation is usually a prompt
that asks the agent nicely to behave.

That is not a security model. A budget should be enforced by the chain, not by
a system prompt.

Oven Mitt makes the budget structural: the agent's key can only ever hold what
you funded it with, so the worst case is bounded by a number you picked, and
every movement is auditable by anyone with an RPC endpoint.

---

## How it works

Three transactions, no custom on-chain program.

### 1. Grant

Your wallet (Nightly) signs one transaction that does two things atomically:

- transfers exactly `cap` lamports to a freshly generated session keypair
- writes an `open` receipt via the SPL Memo program

Because both instructions live in the same transaction, a funded session
without an audit record is not representable.

```json
{"p":"mitt/1","t":"open","s":"7Fq2mKdA","a":"7Fq2mKdA...","c":250000000,"x":1789000000,"n":"research bot"}
```

### 2. Spend

The agent signs with the session key. Each spend carries its own `act` receipt
in the same transaction, so the log cannot drift from the money.

```json
{"p":"mitt/1","t":"act","s":"7Fq2mKdA","k":"transfer","m":"paid 0.05 COOK for data"}
```

### 3. Revoke

Sweeps every remaining lamport back to the owner and writes a `close` receipt.
The agent's cooperation is not required, because the sweep is signed by the
session key you still hold a copy of.

```json
{"p":"mitt/1","t":"close","s":"7Fq2mKdA","r":"revoked"}
```

---

## Threat model: what is actually enforced

Security tooling should be explicit about where its guarantees stop.

### Enforced by Cookie Chain

| Property | Mechanism |
| --- | --- |
| Spend cap | The session key holds exactly what you funded. It cannot spend lamports it does not have. Enforced by the runtime, not by policy. |
| Main wallet isolation | Your wallet signs the grant and nothing else. Its private key is never shared, exported, or held by the app. |
| Audit integrity | Receipt and value transfer share one transaction. Neither can land without the other. |
| Non custodial | The app has no backend database and no server-side keys. Session secrets never leave your browser. |

### Not enforced, and not claimed

| Gap | Reality |
| --- | --- |
| Expiry | Written into the `open` receipt, but advisory. Nothing halts the key at `x`. Revoke, or let the cap run dry. |
| Destination control | Within its cap the agent may pay any address. The cap bounds the size of the loss, not its direction. |
| Receipt authenticity | The Memo program accepts arbitrary bytes from anyone. A receipt only means something in combination with its signer, which is why the indexer surfaces the signer for every entry. |
| Session key custody | The key is in `localStorage` so you can hand it to an agent. Clearing site data loses the ability to revoke from this browser, though the funds remain capped. |

---

## Architecture

No database. No indexer service. No custom program. Every piece of state shown
in the UI is reconstructed by reading Cookie Chain.

```
src/lib/chain.ts      RPC connection, COOK formatting, explorer links
src/lib/receipts.ts   the mitt/1 receipt protocol: encode, tolerant parse, log extraction
src/lib/session.ts    transaction builders for open / act / close
src/lib/indexer.ts    rebuilds sessions from getSignaturesForAddress + parsed memos
src/lib/wallet.ts     Nightly detection and the sign-locally / broadcast-ourselves pattern
src/app/api/feed      public chain-wide feed of every mitt receipt
```

### The Nightly detail worth knowing

Cookie Chain is an independent SVM network, not Solana. A Solana wallet pointed
at Solana mainnet cannot *send* a Cookie Chain transaction for you.

The fix is to never ask it to. Oven Mitt asks the wallet only to **sign**, then
broadcasts the signed bytes to the Cookie Chain RPC itself:

```ts
const signed = await provider.signTransaction(tx);
const sig = await connection.sendRawTransaction(signed.serialize());
```

Ed25519 signatures are network agnostic. The transaction commits to a Cookie
Chain blockhash, so it is only valid there. This is what makes an unmodified
Nightly install work against a non-Solana SVM chain.

---

## Running it locally

Requires Node 22 or newer.

```bash
git clone https://github.com/mandarwagh9/ovenmitt
cd ovenmitt
pnpm install
pnpm dev
```

Open <http://localhost:3000>. Install [Nightly](https://nightly.app/download)
and connect. To grant a session you need a little COOK for the cap plus about
`0.000005 COOK` in fees.

### Configuration

Both are optional and default to Cookie Chain mainnet.

```bash
NEXT_PUBLIC_COOKIE_RPC=https://rpc.cookiescan.io
NEXT_PUBLIC_COOKIE_WSS=wss://wss.cookiescan.io
```

### Verify the chain connection without a wallet

```bash
node scripts/probe.mjs
```

Prints chain version, genesis hash, current slot, a simulated grant
transaction, the fee for it, and confirms the SPL Token, Token-2022,
Associated Token and Memo programs are deployed.

---

## Using a session from an agent

The dashboard hands you a base58 secret key scoped to the cap. Any agent that
can sign a Solana transaction can use it. Nothing about the protocol is
specific to this UI.

```ts
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { buildAgentActionTx } from "./src/lib/session";

const c = new Connection("https://rpc.cookiescan.io", "confirmed");
const agent = Keypair.fromSecretKey(bs58.decode(process.env.MITT_SESSION_KEY!));

const tx = await buildAgentActionTx(
  c, agent.publicKey, new PublicKey(recipient), 10_000_000,
  "transfer", "bought a dataset",
);
tx.sign(agent);
await c.sendRawTransaction(tx.serialize());
```

The spend and its receipt land together. The owner sees it in the dashboard on
the next poll, and anyone can see it on [CookieScan](https://cookiescan.io).

This composes with [`cookie-mcp`](https://www.npmjs.com/package/cookie-mcp),
which gives an MCP agent Cookie Chain tools but signs with whatever key you
give it. Give it a mitt session key instead of your real one and the blast
radius becomes a number you chose.

---

## The receipt protocol (`mitt/1`)

Receipts are JSON in an SPL Memo instruction, kept under 400 bytes.

| Field | Meaning |
| --- | --- |
| `p` | protocol tag, always `mitt/1` |
| `t` | `open`, `act` or `close` |
| `s` | session id, the first 8 characters of the agent pubkey |
| `a` | agent pubkey (`open` only) |
| `c` | cap in lamports (`open` only) |
| `x` | advisory expiry, unix seconds (`open` only) |
| `n` | human label (`open`, optional) |
| `k` | action kind (`act` only) |
| `m` | short human detail (`act`, optional) |
| `r` | close reason (`close` only) |

Parsing is deliberately tolerant: memo bytes are untrusted input written by
anyone, so `parseReceipt` validates shape and returns `null` rather than
throwing.

---

## Deployment

```bash
pnpm build
vercel --prod
```

The app is entirely client-side plus one dynamic route (`/api/feed`), so it
runs anywhere Next.js runs.

---

## Note on pnpm

`.npmrc` pins `virtual-store-dir` into the project. This machine had a global
pnpm setting redirecting the virtual store to an unrelated project, which broke
Turbopack module resolution. Harmless to keep, and it makes the install
reproducible.

---

## License

MIT. See [LICENSE](./LICENSE).

Built for the Cookie Chain cApp bounty.
