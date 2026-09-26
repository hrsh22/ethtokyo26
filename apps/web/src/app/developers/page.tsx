import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Code2, MessageSquareText, Plug, Terminal } from "lucide-react";
import { Commands } from "@/components/agent-tools";
import { agentInstall } from "@/lib/agent-install";

export const metadata: Metadata = { title: "Connect your agent · Accord", description: "Give an assistant an ENS-named, revocable tUSDC budget through Accord's MCP tools or TypeScript SDK." };

const code = (text: string) => <pre className="mt-4 overflow-x-auto rounded-2xl bg-soft p-4 text-[13px] leading-relaxed text-ink-soft"><code>{text}</code></pre>;
const tools = [
  { name: "accord_identity", body: "Verify its ENS name, signer and Space authority.", kind: "read" },
  { name: "accord_budget", body: "Read what’s left, its caps, approval threshold and expiry.", kind: "read" },
  { name: "accord_services", body: "List the research offers and their prices.", kind: "read" },
  { name: "accord_quote", body: "Get an exact price for a report. Nothing is spent.", kind: "quote" },
  { name: "accord_purchase", body: "Pay within its limits, or return your review link when approval is needed.", kind: "spend" },
  { name: "accord_resume", body: "Continue the same quote after you decide. Never buys twice.", kind: "spend" },
  { name: "accord_operations", body: "List recent purchases, including pending ones.", kind: "read" },
  { name: "accord_receipt", body: "Read the confirmed payment and its Sepolia link.", kind: "read" },
  { name: "accord_result", body: "Retrieve the paid report with its sources.", kind: "read" },
] as const;
const badge = { read: ["Read only", "bg-good-soft text-good"], quote: ["No spending", "bg-sky-soft text-[#2B7CC4]"], spend: ["May spend", "bg-tang-soft text-[#ac5127]"] } as const;
const config = `{
  "mcpServers": {
    "accord": {
      "command": "/path/to/node",
      "args": ["/path/to/node_modules/@accord/agent/dist/cli.js", "mcp", "--profile", "default"]
    }
  }
}`;

export default function DevelopersPage() {
  return <div className="mx-auto max-w-[900px]">
    <span className="pill bg-lilac-soft text-[#6544ba]"><Code2 size={15}/>Developer preview · Sepolia</span>
    <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight sm:text-6xl">A budget for your agent.</h1>
    <p className="mt-4 max-w-[650px] text-lg text-ink-soft">Connect an assistant by its ENS name. Let it buy useful research, pause for your approval, and return with a result and receipt.</p>
    <Link href="/demo" className="mt-5 inline-flex items-center gap-1.5 font-semibold text-[#6544ba] hover:underline">See a recorded run first<ArrowUpRight size={16}/></Link>
    <div className="mt-8 grid grid-cols-1 gap-5">
      <section className="card p-7 sm:p-9"><h2 className="flex items-center gap-3 font-display text-2xl font-extrabold"><Terminal className="shrink-0 text-[#6544ba]"/>1. Create a local signer</h2>
        <p className="mt-3 text-ink-soft">Use Node 24 or newer. These commands keep a dedicated key in a private local profile.</p>
        <div className="mt-4"><Commands text={`${agentInstall}\nnpx accord init\nnpx accord connect`}/></div>
        <p className="mt-3 text-sm text-muted">Open the connection link as the Space owner, choose your Space, and give the agent a name and budget. Verify with World ID to authorize its spending rules, then connect it.</p>
      </section>
      <section className="card p-7 sm:p-9"><h2 className="flex items-center gap-3 font-display text-2xl font-extrabold"><Plug className="shrink-0 text-[#6544ba]"/>2. Connect your assistant</h2>
        <p className="mt-3 text-ink-soft">After the terminal confirms the connection, generate your MCP configuration and add it to your assistant’s MCP settings.</p>
        <div className="mt-4"><Commands text="npx accord mcp config"/></div>
        <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold text-muted">What the configuration looks like</summary>
          {code(config)}
          <p className="mt-2 text-muted">It holds local paths and a profile name. The signing key stays in the profile, never in the configuration or a prompt.</p>
        </details>
        <p className="mt-4 text-sm text-muted">For an existing delegation, use its authorized local signer with <code className="break-all">npx accord connect --agent YOUR_AGENT_ENS_NAME</code>. The connector checks the name and its live authority.</p>
      </section>
      <section className="card p-7 sm:p-9" aria-labelledby="tools-heading"><h2 id="tools-heading" className="font-display text-2xl font-extrabold">The tools your assistant gets</h2>
        <p className="mt-3 text-ink-soft">Nine MCP tools, scoped to one agent budget. None of them can approve a payment, raise a limit or reach another Space.</p>
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">{tools.map(tool => <li key={tool.name} className="rounded-2xl bg-soft p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><code className="text-sm font-semibold">{tool.name}</code><span className={`pill text-xs ${badge[tool.kind][1]}`}>{badge[tool.kind][0]}</span></div>
          <p className="mt-1.5 text-sm text-muted">{tool.body}</p>
        </li>)}</ul>
        <p className="mt-4 text-sm text-muted">A purchase moves through <b className="font-semibold text-ink-soft">quoted → awaiting_approval → ready → confirmed → delivered</b>. Denied, expired or revoked authority stops it, and the assistant should not start a replacement.</p>
      </section>
      <section className="card p-7 sm:p-9"><h2 className="flex items-center gap-3 font-display text-2xl font-extrabold"><MessageSquareText className="shrink-0 text-[#6544ba]"/>3. Give it a useful task</h2>
        <blockquote className="mt-4 border-l-4 border-lilac pl-4 text-lg text-ink-soft">Compare these three public GitHub repositories for my integration. Check their maintenance and documented capabilities, cite your sources, and ask me when a purchase needs approval.</blockquote>
        <p className="mt-4 text-sm text-muted">Include the three repository URLs and your criteria. The example research service offers a 1 tUSDC snapshot and 20 tUSDC comparison. Accord operates this test merchant; source timestamps and coverage are included.</p>
        <p className="mt-3 text-sm text-muted">Purchases above your approval threshold appear under <b className="font-semibold text-ink-soft">Needs your approval</b>. Verify with World, decide, and the assistant resumes the original quote. Denial or revoked ENS authority stops spending.</p>
      </section>
      <section className="card p-7 sm:p-9"><h2 className="font-display text-2xl font-extrabold">Use the TypeScript SDK</h2>
        {code(`import { connectProfile } from "@accord/agent";\n\nconst agent = await connectProfile("default");\nconst quote = await agent.getQuote({\n  operationKey: savedOperationKey, // one UUID per purchase\n  repositories: ["owner/repository"],\n  tier: "snapshot", criteria: [],\n});\nconst purchase = await agent.purchase({\n  quoteId: quote.id, operationKey: quote.operationKey,\n});\n// If awaiting_approval, show purchase.reviewUrl and wait.\n// Resume this same quote after approval or confirmation.\n// await agent.resumeOperation(quote.id);`)}
        <p className="mt-4 text-sm text-muted">Amounts use six decimal places. Keep signing keys in your application’s protected configuration, outside prompts. The existing contract enforces identity and spending limits; the example service list is not a merchant allowlist.</p>
        <a href="https://github.com/hrsh22/ethtokyo26/blob/main/packages/agent-kit/README.md" target="_blank" rel="noreferrer" className="mt-4 inline-flex font-semibold text-[#6544ba] hover:underline">Full SDK reference and recovery guide →</a>
      </section>
    </div>
  </div>;
}
