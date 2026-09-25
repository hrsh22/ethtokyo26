import Link from "next/link";
import { AtSign, Ban, Bot, Check, Fingerprint, ScanLine, UserRound } from "lucide-react";
import { AppNav, Footer } from "@/components/app-nav";
import { Avatar } from "@/components/avatar";
import { HeroArt } from "@/components/landing/hero-art";
import { Ring } from "@/components/ring";
import { Button } from "@/components/ui/button";
import { allocationPalette } from "@/lib/palette";

const demoAddress = process.env.NEXT_PUBLIC_DEMO_SPACE_ADDRESS;
const person = allocationPalette(BigInt(1), false);
const lime = allocationPalette(BigInt(3), false);
const agent = allocationPalette(BigInt(1), true);

const steps = [
  { title: "Fill a Space", body: "Deploy it from your wallet and add tokens. Only you can change the rules.", bg: "#FFE7D8" },
  { title: "Pick who and how much", body: "A person with a daily allowance, or an agent with a card-style cap.", bg: "#ECE5FF" },
  { title: "They tap to claim", body: "People verify with World ID. Agents get screened. Everything leaves a receipt.", bg: "#EEFBD6" },
];
const safety = [
  { icon: Fingerprint, title: "World ID", body: "A real, unique human behind every claim, checked fresh each time.", bg: "#FFEBDD", fg: "#E2561C" },
  { icon: AtSign, title: "ENS names", body: "Agents act under a name. If it changes hands, their mandate stops.", bg: "#EEE8FF", fg: "#6F4BEA" },
  { icon: ScanLine, title: "Screening", body: "Intercepta checks each recipient before a payment is signed.", bg: "#E2F4FF", fg: "#2B7CC4" },
  { icon: Ban, title: "Revoke any time", body: "Close an allocation and take back whatever hasn't been spent.", bg: "#FFE3F1", fg: "#D93680" },
];

export default function Landing() {
  return <div className="relative overflow-x-clip">
    <div className="blob right-[8%] top-10 size-[420px] bg-[#FFC39E] opacity-70" />
    <div className="blob -right-32 top-80 size-[420px] bg-[#CDBEFF] opacity-80" />
    <div className="blob -left-32 top-[520px] size-[420px] bg-[#E3FAB8] opacity-80" />
    <AppNav landing />
    <main id="main" className="relative">
      <section className="mx-auto grid max-w-[1240px] items-center gap-12 px-6 pb-8 pt-14 sm:px-10 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
        <div>
          <h1 className="font-display text-[56px] font-extrabold leading-[0.93] tracking-[-0.03em] sm:text-[80px] lg:text-[88px]">Allowances for humans and their AI agents.</h1>
          <p className="mt-7 max-w-[44ch] text-lg text-ink-soft">Set a budget, share a link, and let the rules do the rest. People claim with World ID. Agents spend within limits you can revoke in one tap.</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href="/spaces/new">Start a Space</Link></Button>
            <Button asChild size="lg" variant="light"><Link href={demoAddress ? `/spaces/${demoAddress}` : "#how"}>{demoAddress ? "Try the live demo" : "See how it works"}</Link></Button>
          </div>
          <p className="mt-6 flex items-center gap-2 text-sm text-muted"><span className="size-2 rounded-full bg-good" />Live on Sepolia with free test tokens</p>
        </div>
        <HeroArt />
      </section>

      <section id="how" className="mx-auto max-w-[1240px] scroll-mt-28 px-6 pt-24 sm:px-10">
        <h2 className="font-display text-5xl font-extrabold tracking-[-0.03em] sm:text-[56px]">How it works</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => <li key={step.title} className="relative flex min-h-[300px] flex-col overflow-hidden rounded-[2.1rem] p-7" style={{ background: step.bg }}>
            <span className="font-display text-[84px] font-extrabold leading-[0.9] text-ink/15">{index + 1}</span>
            <h3 className="mt-2 font-display text-[26px] font-extrabold tracking-tight">{step.title}</h3>
            <p className="mt-1 text-ink-soft">{step.body}</p>
            <div className="mt-auto flex items-center gap-2.5 pt-6">
              {index === 0 ? <><Avatar kind="person" palette={lime} size={54} /><span className="pill bg-white">200 ACD</span></> : null}
              {index === 1 ? <><Avatar kind="person" palette={person} size={44} /><Avatar kind="agent" palette={agent} size={44} /><span className="pill bg-white">10 a day</span></> : null}
              {index === 2 ? <><Ring value={0.7} size={70} stroke={10} colors={person.ring} track="#fff" label="Claimed"><b className="font-display text-xl font-extrabold">10</b></Ring><span className="pill bg-white"><Check size={14} strokeWidth={3} />Claimed</span></> : null}
            </div>
          </li>)}
        </ol>
      </section>

      <section className="mx-auto grid max-w-[1240px] gap-4 px-6 pt-20 sm:px-10 md:grid-cols-2">
        {[{ palette: person, kind: "person" as const, tag: "For people", icon: UserRound, title: "Allowances that verify the human.",
          body: "A stipend, a grant or family support. Each claim needs a fresh World ID check, so a stolen phone can't drain it.", name: "kenji.eth", sub: "10 ACD a day, 62 left" },
        { palette: agent, kind: "agent" as const, tag: "For agents", icon: Bot, title: "Pocket money for your AI.",
          body: "Your agent pays for data and APIs from its own capped budget, tied to its ENS name. It never holds your keys.", name: "Research agent", sub: "5 a payment, 20 a day" }].map((mode) =>
          <article key={mode.tag} className="relative min-h-[330px] overflow-hidden rounded-[2.25rem] p-8 sm:p-9" style={{ background: mode.palette.tile, color: mode.palette.ink }}>
            <span className="pill"><mode.icon size={14} strokeWidth={2.4} />{mode.tag}</span>
            <h3 className="mt-5 max-w-[12em] font-display text-[42px] font-extrabold leading-none tracking-[-0.03em]">{mode.title}</h3>
            <p className="mt-3 max-w-[40ch] text-base opacity-85">{mode.body}</p>
            <div className="mt-7 flex items-center gap-3"><Avatar kind={mode.kind} palette={mode.palette} size={48} /><span><b className="block text-lg">{mode.name}</b><small className="opacity-75">{mode.sub}</small></span></div>
          </article>)}
      </section>

      <section id="safety" className="mx-auto max-w-[1240px] scroll-mt-28 px-6 pt-24 sm:px-10">
        <h2 className="font-display text-5xl font-extrabold tracking-[-0.03em] sm:text-[56px]">Safe by default</h2>
        <p className="mt-3 max-w-[56ch] text-lg text-ink-soft">Every claim and payment is checked by Accord before it’s signed, and again by the contract before anything moves.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {safety.map((item) => <div key={item.title} className="card p-6">
            <span className="mb-4 grid size-12 place-items-center rounded-2xl" style={{ background: item.bg, color: item.fg }}><item.icon size={22} strokeWidth={2.1} /></span>
            <b className="block font-display text-[21px] font-extrabold">{item.title}</b>
            <p className="mt-1 text-sm text-muted">{item.body}</p>
          </div>)}
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-6 pt-20 sm:px-10">
        <div className="relative overflow-hidden rounded-[2.75rem] bg-ink px-8 py-14 text-white sm:px-14">
          <div className="blob -right-16 -top-20 size-80 bg-tang opacity-55" />
          <div className="blob -bottom-36 right-56 size-72 bg-lilac opacity-55" />
          <div className="relative">
            <h2 className="max-w-[12em] font-display text-5xl font-extrabold leading-none tracking-[-0.03em] sm:text-[60px]">Start a Space in two minutes.</h2>
            <p className="mt-4 text-lg text-white/70">Free on Sepolia. Bring a wallet; the demo token is ready to use.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" variant="light"><Link href="/spaces/new">Start a Space</Link></Button>
              {demoAddress ? <Button asChild size="lg" className="bg-white/10 shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.3)] hover:bg-white/15"><Link href={`/spaces/${demoAddress}`}>Try the demo</Link></Button> : null}
            </div>
          </div>
        </div>
      </section>
    </main>
    <Footer />
  </div>;
}
