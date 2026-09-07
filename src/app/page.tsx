import Link from "next/link";
import { ArrowRight, GithubLogo, Cube, ShieldCheck, Prohibit } from "@phosphor-icons/react/dist/ssr";
import { LiveChain } from "@/components/LiveChain";
import { Reveal } from "@/components/Reveal";

const REPO = "https://github.com/mandarwagh9/ovenmitt";

const OPEN_RECEIPT = `{"p":"mitt/1","t":"open","s":"7Fq2mKdA",
 "a":"7Fq2mKdA...","c":250000000,"x":1789000000,"n":"research bot"}`;
const ACT_RECEIPT = `{"p":"mitt/1","t":"act","s":"7Fq2mKdA",
 "k":"transfer","m":"paid 0.05 COOK for data"}`;
const CLOSE_RECEIPT = `{"p":"mitt/1","t":"close","s":"7Fq2mKdA","r":"revoked"}`;

const STEPS = [
  {
    verb: "Grant",
    body: "Connect Nightly and open a session. A fresh keypair is funded with exactly the cap you set, and the grant receipt is written in the same transaction.",
    code: OPEN_RECEIPT,
  },
  {
    verb: "Spend",
    body: "The agent signs with the session key. Every spend carries its own receipt, so the audit record cannot drift from the money that actually moved.",
    code: ACT_RECEIPT,
  },
  {
    verb: "Revoke",
    body: "One click sweeps every remaining lamport back to you and closes the session on chain. No cooperation from the agent is required.",
    code: CLOSE_RECEIPT,
  },
];

export default function Home() {
  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-40 h-16 border-b border-line-soft bg-base/85 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="text-accent"><Cube size={19} weight="duotone" /></span>
            <span className="text-[15px] font-semibold tracking-tight">Oven Mitt</span>
          </Link>
          <div className="flex items-center gap-1.5">
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13.5px] text-ink-2 transition-colors hover:text-ink"
            >
              <GithubLogo size={16} /> Source
            </a>
            <Link
              href="/dashboard"
              className="rounded-[10px] bg-accent px-3.5 py-2 text-[13.5px] font-medium text-[#16110a] transition-transform active:scale-[0.98]"
            >
              Open dashboard
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero: asymmetric split. The right column is a real component reading live
          Cookie Chain state, not a mock screenshot. */}
      <section className="mx-auto max-w-6xl px-5 pt-16 pb-20 md:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.18em] text-accent-dim">
              Built on Cookie Chain
            </p>
            <h1 className="text-[2.6rem] font-semibold leading-[1.06] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              Hand an agent money.
              <br />
              Not your wallet.
            </h1>
            <p className="mt-6 max-w-[54ch] text-[16.5px] leading-relaxed text-ink-2">
              A capped, expiring, revocable wallet for AI agents on Cookie Chain.
              Every action leaves an on-chain receipt.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard"
                className="group flex items-center gap-2 rounded-[10px] bg-accent px-5 py-3 text-[14.5px] font-medium text-[#16110a] transition-transform active:translate-y-px"
              >
                Open dashboard
                <span className="transition-transform group-hover:translate-x-0.5">
                  <ArrowRight size={16} weight="bold" />
                </span>
              </Link>
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2 rounded-[10px] border border-line px-5 py-3 text-[14.5px] text-ink transition-colors hover:border-ink-3"
              >
                <GithubLogo size={17} /> Read the source
              </a>
            </div>
          </div>
          <LiveChain />
        </div>
      </section>

      {/* Editorial statement. Second layout family: full width, type led. */}
      <section className="border-y border-line-soft bg-surface/40">
        <div className="mx-auto max-w-4xl px-5 py-20 text-center">
          <Reveal>
            <p className="text-[1.6rem] font-medium leading-[1.45] tracking-tight sm:text-[2rem]">
              An agent holding your private key can spend everything you own.
              <span className="text-ink-3">
                {" "}
                The usual answer is to trust the prompt. That is not a security model.
              </span>
            </p>
          </Reveal>
        </div>
      </section>

      {/* Stepped flow. Third layout family. */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <Reveal>
          <h2 className="max-w-[20ch] text-[1.9rem] font-semibold leading-tight tracking-tight sm:text-[2.3rem]">
            A budget the chain enforces
          </h2>
        </Reveal>
        <div className="mt-14 space-y-14">
          {STEPS.map((s, i) => (
            <Reveal key={s.verb} delay={i * 0.05}>
              <div className="grid gap-6 border-t border-line-soft pt-8 md:grid-cols-[13rem_1fr_1.1fr] md:gap-10">
                <h3 className="text-[1.35rem] font-semibold tracking-tight text-accent">
                  {s.verb}
                </h3>
                <p className="text-[15px] leading-relaxed text-ink-2">{s.body}</p>
                <pre className="num overflow-x-auto rounded-[14px] border border-line bg-surface p-4 text-[12px] leading-relaxed text-ink-2">
                  {s.code}
                </pre>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Honest threat model. Fourth layout family: two column contrast. */}
      <section className="border-t border-line-soft bg-surface/40">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <Reveal>
            <h2 className="text-[1.9rem] font-semibold leading-tight tracking-tight sm:text-[2.3rem]">
              What is actually enforced
            </h2>
            <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-ink-2">
              A security tool should say where its guarantee stops. Here is the line.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-[14px] border border-line bg-surface p-7">
                <span className="text-ok"><ShieldCheck size={22} weight="duotone" /></span>
                <h3 className="mt-4 text-[1.05rem] font-semibold tracking-tight">
                  Enforced by the chain
                </h3>
                <ul className="mt-4 space-y-3 text-[14.5px] leading-relaxed text-ink-2">
                  <li>
                    The spend cap. The session key holds exactly what you funded and
                    cannot spend lamports it does not have.
                  </li>
                  <li>
                    Your main wallet. It never signs an agent action, and its key is
                    never shared with anything.
                  </li>
                  <li>
                    The audit trail. Receipt and transfer share one transaction, so
                    neither can land without the other.
                  </li>
                </ul>
              </div>
            </Reveal>
            <Reveal delay={0.06}>
              <div className="h-full rounded-[14px] border border-line bg-surface p-7">
                <span className="text-ink-3"><Prohibit size={22} weight="duotone" /></span>
                <h3 className="mt-4 text-[1.05rem] font-semibold tracking-tight">
                  Not enforced, and not claimed
                </h3>
                <ul className="mt-4 space-y-3 text-[14.5px] leading-relaxed text-ink-2">
                  <li>
                    Expiry is advisory. It is recorded in the receipt, but nothing
                    halts the key until you revoke or the funds run out.
                  </li>
                  <li>
                    Where the agent sends funds. Inside its cap it can pay anyone. The
                    cap bounds the loss, not the destination.
                  </li>
                  <li>
                    Anyone can write a receipt. Always check the signer, which is what
                    the dashboard does for you.
                  </li>
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13.5px] text-ink-3">Open source, MIT. Built on Cookie Chain.</p>
          <div className="flex items-center gap-5 text-[13.5px] text-ink-3">
            <a href={REPO} target="_blank" rel="noreferrer noopener" className="hover:text-ink">
              GitHub
            </a>
            <a href="https://www.cookiechain.wtf" target="_blank" rel="noreferrer noopener" className="hover:text-ink">
              Cookie Chain
            </a>
            <a href="https://cookiescan.io" target="_blank" rel="noreferrer noopener" className="hover:text-ink">
              Explorer
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
