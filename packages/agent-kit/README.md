# Accord agent toolkit

Connect an assistant to an ENS-named agent's delegated **tUSDC** budget on **Ethereum Sepolia**. The SDK and local MCP server share one purchase runtime. A dedicated local signer authorizes payments; the Space enforces limits and live ENS authority. Sensitive purchases wait for the same verified owner in Accord's World ID for Agents flow.

## Install and connect

Requires **Node.js 24+**. Install the versioned artifact in a project folder:

```sh
npm install https://accord.hrsh.dev/downloads/accord-agent-0.1.0.tgz
npx accord init
npx accord connect
```

Open the terminal's private connection link. Sign in as the Space owner, choose a Space, and give the displayed signer an agent name and budget. Match its full address against the terminal. Authorize the budget with World ID, then approve the connection. Return to the terminal to finish.

For an already-authorized signer, use `npx accord connect --agent research.<space>.accordspaces26.eth`. A newly generated key cannot assume an existing agent's identity: reuse that agent's original profile, or authorize the new signer with its own budget. Connection IDs are discovered during pairing; no contract/allocation IDs need to be copied.

Suggested demo limits: 100 tUSDC budget, 100 daily cap, 25 per payment, approval above 10. The token faucet is in the app. Agents and owners need no Sepolia ETH for sponsored actions.

`init --profile research` creates another signer. Pass the same `--profile research` to subsequent commands. Keys stay in `~/.config/accord/profiles/`, in files readable only by the local user. Generated MCP configuration contains no key. Never paste keys, profile contents or private connection links into model prompts. Windows users must restrict the directory's ACL to their account.

## MCP setup

```sh
npx accord mcp config
```

Copy the generated `mcpServers.accord` entry into a client supporting local stdio MCP servers. It contains absolute Node/CLI paths and a profile name, so no shell PATH or secret is needed. Keep the installation at that path. `npx accord mcp` runs the server; stdout is reserved for protocol messages.

Example task:

> Compare ensdomains/ens-contracts, wevm/viem and modelcontextprotocol/typescript-sdk for my TypeScript integration. Inspect your budget and available research offers. Buy a useful report, cite sources and explain gaps. Ask me when owner approval is needed; wait for my response before resuming.

| Tool | Purpose |
| --- | --- |
| `accord_identity`, `accord_budget` | Verify the named agent and inspect live authority and limits. |
| `accord_services`, `accord_quote` | Discover offers and exact immutable terms, without paying. |
| `accord_purchase` | Purchase that quote; may return a human review URL. |
| `accord_operations`, `accord_resume` | Inspect/resume the same operation after approval or interruption. |
| `accord_receipt`, `accord_result` | Retrieve a confirmed payment and its purchased evidence. |

There is no arbitrary signing, owner approval or delegation tool. Repository text is untrusted data. Protocol tests exercise discovery, schema rejection, purchase and resume with the official TypeScript MCP client; this alone does not claim compatibility with every assistant or constitute a recorded AI demonstration.

## JavaScript / TypeScript

```js
import { connectProfile } from '@accord/agent';

const agent = await connectProfile('default');
console.log(await agent.getIdentity());
console.log(await agent.getBudget());

// Persist one UUID per intended purchase; reuse it after a timeout.
const operationKey = 'b19603e6-6cb2-438d-9686-13f77e14c2af';
const quote = await agent.getQuote({
  operationKey,
  repositories: ['ensdomains/ens-contracts', 'wevm/viem'],
  tier: 'comparison',
  criteria: ['TypeScript', 'documentation'],
});
const operation = await agent.purchase({ quoteId: quote.id, operationKey });
console.log(operation); // save quote.id; display reviewUrl if awaiting_approval

// On a later invocation, after owner approval or transaction confirmation:
// const resumed = await agent.resumeOperation(savedQuoteId);
// const receipt = await agent.getReceipt(savedQuoteId);
// const evidence = await agent.getResult(savedQuoteId);
```

Integrators with their own key management can use `connect({ agentName, signer, connectionId, apiUrl?, webOrigin?, rpcUrl?, stateDirectory? })` with a viem LocalAccount and an owner-accepted connection from `pairingClient({ signer }).start(name)` / `.poll(pairing)`. `resolveAgent(name)` independently checks ENS resolution and the onchain mandate. HTTP is allowed only on localhost; remote APIs require HTTPS.

Amounts are integer strings with **six decimals**: `1000000` is 1 tUSDC. The runtime validates the exact permit, signer, network, recipient, token, allocation and request ID before signing. The API is a trusted permit authorizer and example merchant; this is not a trustless marketplace.

## Research offers

Accord's public GitHub aggregation example sells a **1 tUSDC snapshot** or **20 tUSDC comparison** for up to three repositories. Comparison adds up to ten releases, a 90-day default-branch commit sample (up to 100 commits), and README keyword excerpts for up to three criteria.

Reports include source URLs, collection timestamps and missing/truncated coverage. README matches are evidence to inspect, not proof of feature support. There are no invented quality/security scores. Source snapshots are cached for five minutes. Data is collected before quoting, saved as an immutable artifact, and released only for the exact confirmed payment. Source outages/rate limits fail before offering a new quote. Prices and World identities belong to the test/sandbox environment.

## Recovery and revocation

- Keep the operation key and returned quote ID. Retrying a key returns the same terms; changing its terms is rejected.
- `awaiting_approval`: stop and show the owner the review URL. Never approve for them. Resume after their response.
- `submitted`: broadcast, not confirmed. `reconciling`: the request is consumed but its receipt has not yet been located. Resume later; do not create a replacement purchase.
- `denied`, `cancelled`, `expired`, `invalidated`: stop. An expired quote requires explicit new purchase intent and a new quote. There is no automatic re-pricing.
- Lost responses are recovered from stored submissions and payment events. Result retrieval never initiates a payment. Confirmed results remain accessible after ENS revocation while the connection is valid.
- Journals live under `~/.config/accord/state/`. A shared signer lock serializes local processes. Wait 30 seconds after a crash before retrying. Do not share a signer across machines.
- `submission_uncertain` means inspect the saved operation/transaction before proceeding. The runtime stops instead of silently signing another payment. Contracts also reject reused request IDs.
- `npx accord disconnect` disables the tooling credential, but cannot invalidate signed permits. **Revoke ENS authority in the Space to stop spending**, including an unsubmitted cached permit. Connections expire after 30 days; reconnecting requires owner consent.

Agent credentials cannot call owner, funding, beneficiary or World-approval routes. A private key is still a wallet key: use a dedicated agent signer, never an owner's key. Keep the profile/journal when restarting or updating.

## Development and licensing

Build with `pnpm --filter @accord/agent build`; test with `pnpm --filter @accord/agent test`. `apps/agent-demo` is a deterministic SDK example with an environment template, not an autonomous model. The older Space spending report remains an API integration fixture.

MIT license applies to this package and its bundled Accord contract ABIs. Install from the versioned tarball; no npm registry publication is claimed.
