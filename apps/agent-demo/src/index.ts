import { connectProfile, AccordError } from "@accord/agent";

// A deterministic SDK example. The assistant chooses reports through MCP;
// this runner exercises the same runtime without claiming to be an AI agent.
async function main() {
  const agent = await connectProfile(process.env.ACCORD_PROFILE ?? "default");
  const resume = process.env.ACCORD_QUOTE_ID;
  if (resume) { console.log(JSON.stringify(await agent.resumeOperation(resume), null, 2)); return; }
  if (!process.env.ACCORD_OPERATION_KEY || !process.env.ACCORD_REPOSITORIES) {
    console.log(JSON.stringify({ identity: await agent.getIdentity(), budget: await agent.getBudget(), services: await agent.listServices() }, null, 2));
    console.log("To purchase: set ACCORD_OPERATION_KEY to a stable UUID and ACCORD_REPOSITORIES to comma-separated owner/repo names. Save the returned quote ID; use ACCORD_QUOTE_ID to resume."); return;
  }
  const quote = await agent.getQuote({ operationKey: process.env.ACCORD_OPERATION_KEY,
    repositories: process.env.ACCORD_REPOSITORIES.split(",").map(s => s.trim()),
    tier: process.env.ACCORD_TIER === "comparison" ? "comparison" : "snapshot",
    criteria: process.env.ACCORD_CRITERIA?.split(",").map(s => s.trim()) ?? [] });
  console.log(JSON.stringify({ step: "quoted", quote }, null, 2));
  console.log(JSON.stringify(await agent.purchase({ quoteId: quote.id, operationKey: quote.operationKey }), null, 2));
}
main().catch(error => { console.error(error instanceof AccordError ? `${error.code}: ${error.message}` : "The example could not complete. Resume the same operation after checking its status."); process.exitCode = 1; });
