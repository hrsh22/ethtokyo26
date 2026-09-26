# Four-minute Accord demo

**Target runtime: 3:50**, leaving ten seconds beneath the four-minute limit. This cut demonstrates World ID for Agents, ENSv2 authority and the external assistant's payment task for Curvegrid. The beneficiary IDKit claim is a separate flow; this video does not demonstrate that integration.

**Story:** a person delegates a budget, an assistant buys useful research with their approval, and the person can stop it through either denial or identity revocation.

## Website entry point

The **Demo** link opens [the public evidence overview](https://accord.hrsh.dev/demo). No wallet is needed to inspect these three published runs:

1. **Approved purchase:** the same-owner World sandbox approval record and confirmed 20 tUSDC payment, with a direct Sepolia receipt link. Report terms sit under **Request details**; repository links are not presented as payment or approval evidence.
2. **Denied purchase:** the owner's denial, historical ENS authority at the quote's block, no submitted payment and an unconsumed onchain request.
3. **Revoked authority:** the real ENS revocation receipt and a read-only historical replay. The same signed payment passes at block 11784182 and fails with `InvalidEnsAuthority` at block 11784183, with 114 seconds still left on its permit. The replay broadcasts no transaction.

The page displays the agent's current identity status separately from the recorded outcomes. Evidence checks refresh about once a minute and distinguish backend records, Sepolia reads and historical simulation. Missing or mismatched evidence never gets a successful check. Private sessions, World identifiers and signatures are not published.

**Explore the Space** opens the recorded Tokyo Team Space; **Connect your agent** opens the developer quickstart. The recorded agent was intentionally revoked. Create a fresh agent for the video, and perform the task through the real external assistant and existing approval/revocation controls. The overview provides context and evidence for judges; it does not run an autonomous agent in the browser.

## Prepare before recording

- Use the [toolkit quickstart](../packages/agent-kit/README.md) to install the connector, create a dedicated signer and complete owner pairing in a local stdio MCP client. Keep the assistant and Accord in two ready browser/app tabs.
- Create a fresh active agent in a named Space. Fund **100 tUSDC**, with **100 daily cap**, **25 per payment**, and **approval above 10**. Complete the owner's initial World authorization. Use an expiry comfortably beyond the recording session.
- Start signed in as that same owner. The video begins after setup; describe the budget as already delegated. Show the fresh verification for the actual sensitive purchase during the recording.
- Keep the full agent ENS name readable on its allocation page. Prepare the developer-tools sheet for the closing segment. The agent used in previous revocation evidence is inactive, so create a fresh one for this recording.
- Keep pairing links and local key/profile files out of the recording. Show a small **Sepolia · test tUSDC · World sandbox** caption when introducing the environment.
- Rehearse tool responses and browser navigation. Quotes last ten minutes; create each quote during its segment instead of keeping old approval links for the final take. Revoke last because the action deliberately stops that agent.

## Timeline and narration

| Time | Screen and action | Suggested narration |
| --- | --- | --- |
| **0:00–0:15** | Open on the Space and its named agent. | “Accord lets people give AI agents a budget, approve sensitive purchases, and revoke their authority. Let's use it to buy research for a developer integration.” |
| **0:15–0:35** | Show the agent's full ENS name, active status, 100 tUSDC budget, 25 payment cap and 10 approval threshold. | “I've already delegated this budget. The agent has an ENSv2 subname with revocable authority. It can spend within its limits; purchases above ten need my approval.” |
| **0:35–1:05** | In the assistant, send prompt A below. Show budget/service discovery, the 20 tUSDC quote, `awaiting_approval` and its review link. | “The assistant uses Accord's MCP tools to inspect its budget and request this comparison. It stops here because the purchase needs me.” |
| **1:05–1:40** | Open the actual review link. Show report terms, amount and recipient. Complete the World event authentication, return, and explicitly approve. | “I review the exact purchase and verify again through World. Accord validates the result and requires the same person who authorized this agent. Then I approve these terms.” |
| **1:40–2:10** | Send prompt B. Show the confirmed transaction link, sourced result and 80 tUSDC remaining if this is the only successful purchase. | “The assistant resumes the same purchase, receives the report and returns its sources and payment receipt. The budget has decreased by twenty.” |
| **2:10–2:40** | Request a new comparison with prompt C. Open its review page and deny it. Resume that quote in the assistant: `denied`, no transaction. | “For a second request, I say no. Its name and budget are still valid, but the payment does not happen.” |
| **2:40–3:20** | Use prompt D to quote a 1 tUSDC snapshot without purchasing. Revoke ENS authority in the owner controls; wait for confirmation. Attempt that same quote in the assistant: `ens_revoked`. | “This one tUSDC purchase is below the approval threshold. I revoke the ENS identity before it executes. The assistant can no longer spend, even with budget remaining.” |
| **3:20–3:40** | Open **Developer tools** or the public developer quickstart. Show the install/connect commands and MCP option. | “Other developers can use these controls through our TypeScript SDK or MCP connector. The dedicated signer stays local; the assistant gets scoped tools.” |
| **3:40–3:50** | Return to the revoked agent and its remaining budget. End with the app/repository links. | “World connects sensitive actions to the verified owner. ENS makes agent authority revocable. The Space contract enforces the budget.” |

## Assistant prompts

Send these one at a time. The assistant should use actual Accord tools and show concise results. Keep one operation key per intended purchase and reuse each quote ID when resuming.

### A. Useful purchase

> Use Accord to inspect your identity, budget and research offers. Buy the 20 tUSDC repository comparison for ensdomains/ens-contracts, wevm/viem and modelcontextprotocol/typescript-sdk, focusing on TypeScript and documentation. Explain how each fits into our agent integration, with sources and coverage gaps. Spend at most 20 tUSDC. If owner approval is needed, show the review link and wait. Keep your replies concise and retain the quote ID.

### B. Continue after approval

> I approved that request. Resume the same quote, retrieve its result and confirmed receipt, then show three concise findings with sources and the remaining budget. Do not create a new purchase.

If the response is `submitted` or `reconciling`, let it confirm and resume the same operation. Do not call a broadcast transaction confirmed before a receipt arrives.

### C. Denial

> For a separate purchase, request a new 20 tUSDC comparison for those repositories, this time using maintenance as the criterion. Show its owner review link and wait for my decision.

After clicking **Deny**:

> I denied it. Check that same operation and show its status and transaction hash, then stop.

### D. ENS revocation

> Obtain a new 1 tUSDC snapshot quote for ensdomains/ens-contracts. Show the quote ID and price, but do not purchase it yet. Wait for my instruction.

After **Revoke ENS** confirms:

> Try to purchase that same snapshot quote. If authorization fails, report the error and stop; do not reconnect, request a new identity or create another purchase.

## Keep the evidence clear

- Capture real interactions in order. If loading waits are trimmed, label the shortened wait and preserve the sequence of request, verification, decision and result. Keep the actual World handoff and owner decision visible.
- Read the useful finding returned by the assistant; do not script a claim about repository maintenance or features before seeing its cited result. The repositories play different roles, so explain their roles rather than ranking them as interchangeable tools.
- The 1 tUSDC revocation check needs no extra payment approval, making the ENS failure easy to isolate. It demonstrates revoked authority stopping spending. It does **not** demonstrate that a signed payment permit was already cached.
- Link the [existing cached-permit evidence](agent-toolkit-live-evidence.md) for that stronger claim: the controlled test saved an unexpired signed permit and checked failure after actual ENS revocation. The toolkit evidence uses live simulation; the [earlier walkthrough](ens-world-live-evidence.md) separately includes a broadcast reverted transaction.
- The API authorizer validates World and owner consent; the contract checks its signed permit, live ENS authority and spending limits. Avoid implying the Space directly validates World OIDC tokens.
- If runtime is tight, shorten the introductory narration and developer quickstart segment. Keep the successful payment/result, real verification, denial and revocation visible. Rehearse to finish by **3:50**.

**Status:** recording plan only. A completed narrated video has not yet been produced.
