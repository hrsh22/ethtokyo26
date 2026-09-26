import Link from "next/link";
import { ArrowLeft, AtSign, Code2, Fingerprint, Plug } from "lucide-react";

const install = "npm install https://accord.hrsh.dev/downloads/accord-agent-0.1.0.tgz";
const code = (text: string) => <pre className="mt-4 overflow-x-auto rounded-2xl bg-soft p-4 text-[13px] leading-relaxed text-ink-soft"><code>{text}</code></pre>;
export default function DevelopersPage() {
  return <div className="mx-auto max-w-[900px]">
    <Link href="/spaces" className="mb-6 inline-flex items-center gap-2 font-semibold text-muted"><ArrowLeft size={18}/>Your Spaces</Link>
    <span className="pill bg-lilac-soft text-[#6544ba]"><Code2 size={15}/>Developer preview · Sepolia</span>
    <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight sm:text-6xl">A budget for your agent.</h1>
    <p className="mt-4 max-w-[650px] text-lg text-ink-soft">Connect an assistant by its ENS name. Let it buy useful research, pause for your approval, and return with a result and receipt.</p>
    <div className="mt-8 grid gap-5">
      <section className="card p-7 sm:p-9"><h2 className="flex items-center gap-3 font-display text-2xl font-extrabold"><Plug className="text-[#6544ba]"/>1. Create a local signer</h2>
        <p className="mt-3 text-ink-soft">Use Node 24 or newer. These commands keep a dedicated key in a private local profile.</p>
        {code(`${install}\nnpx accord init\nnpx accord connect`)}
        <p className="mt-3 text-sm text-muted">Open the connection link, choose your Space, and give the agent a name and budget. Verify with World ID to authorize its spending rules.</p>
      </section>
      <section className="card p-7 sm:p-9"><h2 className="flex items-center gap-3 font-display text-2xl font-extrabold"><AtSign className="text-[#6544ba]"/>2. Connect your assistant</h2>
        <p className="mt-3 text-ink-soft">After the terminal confirms the connection, generate your MCP configuration and add it to your assistant’s settings.</p>
        {code("npx accord mcp config")}
        <p className="mt-3 text-sm text-muted">For an existing delegation, use its authorized local signer with <code className="break-all">npx accord connect --agent YOUR_AGENT_ENS_NAME</code>. The connector checks the name and its live authority.</p>
      </section>
      <section className="card p-7 sm:p-9"><h2 className="flex items-center gap-3 font-display text-2xl font-extrabold"><Fingerprint className="text-[#6544ba]"/>3. Give it a useful task</h2>
        <blockquote className="mt-4 border-l-4 border-lilac pl-4 text-lg text-ink-soft">Compare these three public GitHub repositories for my integration. Check their maintenance and documented capabilities, cite your sources, and ask me when a purchase needs approval.</blockquote>
        <p className="mt-4 text-sm text-muted">Include the three repository URLs and your criteria. The example research service offers a 1 tUSDC snapshot and 20 tUSDC comparison. Accord operates this test merchant; source timestamps and coverage are included.</p>
        <p className="mt-3 text-sm text-muted">Sensitive purchases wait for the same verified owner. After approval, resume the original quote. Denial or revoked ENS authority stops spending.</p>
      </section>
      <section className="card p-7 sm:p-9"><h2 className="font-display text-2xl font-extrabold">Use the TypeScript SDK</h2>
        {code(`import { connectProfile } from "@accord/agent";\n\nconst agent = await connectProfile("default");\nconst quote = await agent.getQuote({\n  operationKey: savedOperationKey, // one UUID per purchase\n  repositories: ["owner/repository"],\n  tier: "snapshot", criteria: [],\n});\nconst purchase = await agent.purchase({\n  quoteId: quote.id, operationKey: quote.operationKey,\n});\n// If awaiting_approval, show purchase.reviewUrl and wait.\n// Resume this same quote after approval or confirmation.\n// await agent.resumeOperation(quote.id);`)}
        <p className="mt-4 text-sm text-muted">Amounts use six decimal places. Keep signing keys in your application’s protected configuration, outside prompts. The existing contract enforces identity and spending limits; the example service list is not a merchant allowlist.</p>
        <a href="https://github.com/hrsh22/ethtokyo26/blob/main/packages/agent-kit/README.md" target="_blank" rel="noreferrer" className="mt-4 inline-flex font-semibold text-[#6544ba] hover:underline">Full SDK reference and recovery guide →</a>
      </section>
    </div>
  </div>;
}
