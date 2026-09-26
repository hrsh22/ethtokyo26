# Accord demo

**Pitch:** A verified person delegates a revocable budget to a named agent.

For the submission recording, use the [four-minute video script](demo-video-script.md): a 3:50 cut with setup prepared beforehand, one useful approved purchase, denial and ENS revocation. The walkthrough below is the complete rehearsal guide.

## Assistant purchase demo

Use an external assistant that supports local stdio MCP servers. The [toolkit quickstart](../packages/agent-kit/README.md) covers installation, scoped credentials and recovery. Use a fresh agent: the names in the recorded revocation tests are intentionally inactive.

1. Create a Space and claim tUSDC from the faucet. Open **Space ENS** to show its registered name and the namespace for its agents.
2. In a local project folder with Node 24+, install and start pairing:

   ```sh
   npm install https://accord.hrsh.dev/downloads/accord-agent-0.1.0.tgz
   npx accord init
   npx accord connect
   ```

   Open the private connection link as the owner. Choose the Space, create a name for the displayed signer, and set **100 tUSDC total**, **100 per day**, **25 per payment**, and **approval above 10**. Fund the allocation, complete fresh World authentication and explicitly **Authorize agent**. Then approve the tooling connection and return to the terminal. The first verification binds the owner; later authority increases must authenticate that same person again.
3. Run `npx accord mcp config` and add the generated entry to the assistant's MCP settings. It contains local executable paths and the profile name. Keep keys, profile contents and the private pairing URL out of prompts and recordings. Show the agent's public ENS name, active status and limits.
4. Ask the assistant to inspect its identity, budget and research offers, then buy the **1 tUSDC snapshot** for `ensdomains/ens-contracts`, `wevm/viem` and `modelcontextprotocol/typescript-sdk`. It should return the source-linked result and receipt. This demonstrates routine spending within the delegated policy.
5. Ask for a **20 tUSDC comparison** of those repositories, using `TypeScript` and `documentation` as criteria. The assistant obtains a quote, attempts the purchase, then stops at `awaiting_approval` and shows the owner the review URL. No transaction has been submitted. The owner's **Needs your approval** inbox shows the same request.
6. As owner, review the exact repositories, criteria, amount and recipient. Verify freshly with World and explicitly **Approve payment**. Tell the assistant to resume the **same quote ID**, retrieve the result and receipt, and explain its findings with source URLs and coverage gaps. A reconnect or repeated result lookup must return the existing purchase without another debit.
7. Request a separate comparison, then **Deny** as owner. Ask the assistant to resume that quote. Show `denied` with no transaction, while its ENS authority is still active. It should stop rather than create a replacement purchase.
8. Request and approve a new comparison but tell the assistant to wait before resuming. Use **Revoke ENS** in the allocation's owner controls, then resume that same quote. Show `ens_revoked` and no new payment. Previously purchased results remain retrievable while the tooling connection is valid.

For the last step, approving a quote and pausing the assistant does not by itself prove that a signed permit was cached. The separate [live evidence](agent-toolkit-live-evidence.md) records the controlled check: a signed, unexpired permit passed simulation before actual ENS revocation and failed afterward. The [earlier contract walkthrough](ens-world-live-evidence.md) also includes a broadcast reverted payment. Keep these forms of evidence distinct.

The merchant is operated by Accord and sells real public GitHub research for test tUSDC. The assistant interprets the returned evidence; repository excerpts and commit counts are not quality or security scores. Record its actual tool calls and result, not just the wallet UI or deterministic runner output.

Use the official World Agents sandbox. It uses fake event identities; describe it as a sandbox authentication demonstration. The actual code exchange, JWT validation, identity binding, consent, ENS registration, and Sepolia transactions are real. IDKit beneficiary verification is a separate integration, not silently treated as the same credential.

The authorization boundary is **live ENS identity + budget/caps + exact human consent when required + unconsumed permit**. World and consent are checked by the trusted API authorizer; the Space enforces the signed permit, financial limits and live ENS hierarchy.

## Rehearsal and evidence

- [Live SDK/MCP evidence](agent-toolkit-live-evidence.md) records clean installation, real repository-research purchases, denied requests, restart recovery and ENS revocation checks. The narrated end-user assistant recording remains pending.
- [Curvegrid implementation guide](curvegrid-ai-agent.md) maps the AI Agent prize requirements to the repository and evidence. MultiBaas is not used.
- [Completed live walkthrough evidence](ens-world-live-evidence.md) contains the successful payments, denied request, provider nonce rejection and onchain rejection after ENS revocation.
- [Deployment manifest](../deployments/ens-world-sepolia.json) lists the root name, pinned ENS implementations, new factory and adapter, and infrastructure transactions.
- `apps/api/scripts/demo-ens-world.mts` drives the live API using the configured test wallets. It never inserts a verified identity or policy. Its private session file is in `.data/`; do not publish it.
- `prepare` creates/funds a demo and writes the real World authorization URL privately. Complete that URL in the browser, then `issue` records explicit consent and deploys the ENS identity. `routine`, `request-payment`, `authenticate-payment`, `approve-payment`, `deny`, `cache-payment`, and `revoke-cached` exercise the corresponding cases.
- The final `revoke-cached` action intentionally submits a failing transaction from the test agent to record onchain rejection. Its small testnet gas cost is only a test procedure; normal app calls use the sponsor and reject that request during preflight.
- Unit tests in `approvals.test.ts` mock World/chain responses. They test protocol enforcement and do not count as live provider proof. The older local browser harness predates the new agent authorization model.

## ENS and World roles

| Control | What it establishes |
| --- | --- |
| World ID for Agents | The same owner freshly verified before granting/increasing authority or approving sensitive terms. |
| ENSv2 namespace and resolver | A visible, expiring, revocable agent identity. The agent cannot transfer, renew or administer its name. |
| Space contract | Budget, daily/per-payment caps, permit binding and replay prevention; checks the full ENS hierarchy at execution. |
| IDKit for a beneficiary | Enrollment continuity and a fresh proof bound to that beneficiary’s exact claim. |

The backend operates the namespace’s privileged root roles. Space owners authorize changes through authenticated owner routes. This operator trust, and the API permit signer’s trust, are documented in the integration plan.

## Five-minute claiming demo

1. Claim 1,000 tUSDC with **Get 1,000 tUSDC** on **Your Spaces** or during **New Space** setup. You can claim again whenever the owner needs more test tokens. Accord pays Sepolia network fees for new tUSDC Spaces. Create a **new tUSDC Space**; old ACD Space records have been removed from this app.
2. Signed in as the beneficiary, choose **Link World ID** on **Your Spaces** before funding. Each subsequent claim still needs a fresh check. To record the linking step again, choose **Unlink World ID** there and then **Link World ID**; prior onchain claims remain unchanged.
3. As the owner, choose **Give someone a budget → A person**, confirm the beneficiary and choose **Every minute**, up to **10 tUSDC** each minute, for **5 minutes**. Use **50 tUSDC total** (or **Set the total**).
4. Once funding confirms, the beneficiary finds the allowance under **Shared with you** on **Your Spaces** and claims 10 tUSDC immediately. The owner can still send the direct allocation link. The ring empties and the button disables. The countdown shows the next refill; allowance refreshes after a block enters the next 60-second window.
5. Claim again after the refill. At five minutes, the allocation ends. On the allowance page, **Manage → Close** returns any remainder to the owner.

There are exactly five windows measured from the funding block, including the immediately available first window. Unused allowance does not accumulate. These are contract rules, not a browser-only timer or a World ID bypass. The general timed-allocation API accepts intervals from 60 seconds to one day and durations up to 365 days, in whole intervals. The UI offers per-minute allowances for a chosen number of minutes, and daily allowances either with no end date or for a chosen number of days (for example **1 month**, which is 30 days). Monthly allowances have no end date. Timed allowances and end dates need a Space from the scheduled factory; the form says so for older Spaces.

The current factory is `0x2C080f4EAEB124E07c50F6b9324fAb7894E97A63` on Sepolia. Every Space it creates supports timed allowances and sponsored transactions. Spaces from earlier deployments are no longer trusted by the API.

## Deterministic SDK example

`apps/agent-demo` uses the same paired profile and SDK as MCP. It is a reproducible Node example, not an autonomous model. After completing `accord connect` on the same machine, run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @accord/agent-demo... build
ACCORD_PROFILE=default pnpm --filter @accord/agent-demo dev
```

With no purchase inputs, the last command reads identity, budget and offers. To initiate one comparison, generate an operation key **once**, then retain that value and the returned quote ID:

```sh
export ACCORD_PROFILE=default
export ACCORD_OPERATION_KEY="$(node -e 'console.log(crypto.randomUUID())')"
export ACCORD_REPOSITORIES=ensdomains/ens-contracts,wevm/viem,modelcontextprotocol/typescript-sdk
export ACCORD_TIER=comparison
export ACCORD_CRITERIA=TypeScript,documentation
pnpm --filter @accord/agent-demo dev
```

If the result is `awaiting_approval`, open its `reviewUrl` as the owner and make the decision. Resume using the quote ID printed in that result:

```sh
ACCORD_QUOTE_ID=PASTE_RETURNED_QUOTE_ID pnpm --filter @accord/agent-demo dev
```

For `submitted` or `reconciling`, wait for confirmation and resume the same quote. For `denied`, `cancelled`, `expired` or `invalidated`, stop. A new purchase requires new intent; do not generate a fresh operation key simply to retry a timeout. See the [environment template](../apps/agent-demo/.env.example); the runner reads process environment variables and does not automatically load that file. No raw private key, draft ID or allocation ID is needed in the example's environment.

### Earlier browser report fixture

The allocation page's **Get a quote** / **Retrieve the report** flow remains a separate chain-state report showing remaining budget, caps and ENS authority. It is useful for payment regression checks; it is not the repository research bought through MCP. Its backend `RESEARCH_PRICE_BASE_UNITS` setting does not change the toolkit's 1/20 tUSDC repository offers.

## Demo-only unlink

The small red icon on the right of the World ID linked row opens the existing modal. Its disclaimer is: **Unlinking is enabled for demo purposes only and will be removed later.** Unlinking resets IDKit enrollment for rehearsal; it does not erase payment history or change the separate owner identity used by pending/issued agent approvals.

## Integration pointers

- [World Agents OIDC validation](../apps/api/src/world-agents.ts), [approval lifecycle](../apps/api/src/approvals.ts), [review UI](../apps/web/src/components/approval-review.tsx).
- [ENS issuance](../apps/api/src/namespaces.ts), [hierarchical adapter](../contracts/src/HierarchicalEnsPermissionAdapter.sol), [Space enforcement](../contracts/src/SpaceAccount.sol).
- [Payment approval gate](../apps/api/src/payment-approval.ts), [permit signing](../apps/api/src/permits.ts), [independent agent](../apps/agent-demo/src/index.ts).
- [IDKit validation](../apps/api/src/world.ts), [integration feedback](integration-feedback.md), [current implementation plan and prize mapping](ens-world-integration-plan.md).

Intercepta is excluded from this demonstration and is not a prerequisite for payments. Record a short video of success, denial and ENS revocation before submission; the implementation and transaction evidence do not substitute for that walkthrough.
