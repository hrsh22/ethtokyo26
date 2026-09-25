# Accord demo

**Pitch:** A verified person delegates a revocable budget to a named agent.

## Main walkthrough

1. Create a Space. Open **Space ENS** to show its registered name and explain that agents can have names beneath it. Then choose **Give someone a budget → An agent**.
2. Choose the agent label and wallet. Show the full **ENSv2** subname preview. Set 100 tUSDC total, 100 per day, 50 per payment, and **Require approval above 10**.
3. Fund the inert budget, review its exact terms, choose **Verify with World ID**, then **Authorize agent**. The first verification binds the owner; later authority increases must authenticate that same person again.
4. Open the agent allocation. Show its ENS name, active status, expiry and World authorization. The namespace and agent resolver are real Sepolia ENSv2 contracts.
5. As the agent, pay 1 tUSDC: routine spending stays within the approved caps. Request 20 tUSDC: no permit is issued yet. The request appears under **Needs your approval** on the owner’s Spaces page.
6. As owner, review the exact amount and recipient, verify freshly with World, and explicitly **Approve payment**. As agent, **Continue payment** to receive a confirmed receipt. Refreshing keeps the same request; it does not create another payment.
7. Request another 20 tUSDC, then **Deny** as owner. The agent cannot pay even though ENS is still active.
8. Approve one more request, then use **Revoke ENS** in the allocation’s owner controls. Show the revoked ENS status and failed payment. A previously issued permit also fails at the Space contract after ENS revocation.

Use the official World Agents sandbox. It uses fake event identities; describe it as a sandbox authentication demonstration. The actual code exchange, JWT validation, identity binding, consent, ENS registration, and Sepolia transactions are real. IDKit beneficiary verification is a separate integration, not silently treated as the same credential.

The authorization boundary is **live ENS identity + budget/caps + exact human consent when required + unconsumed permit**. World and consent are checked by the trusted API authorizer; the Space enforces the signed permit, financial limits and live ENS hierarchy.

## Rehearsal and evidence

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

## Paid report task

**Get a quote** in the agent allocation buys a report from the configured seller after the exact onchain payment is confirmed. The report shows remaining budget, daily headroom, per-payment limits and ENS authority at the payment block. It is a chain-state report from a scripted service.

Set `RESEARCH_SELLER_ADDRESS` and `RESEARCH_PRICE_BASE_UNITS` in the backend environment. The default demonstration price is 1 tUSDC. Choose a lower approval threshold if this purchase should pause for the owner.

The independent Node agent runs the same API with `ACCORD_AGENT_TASK=research`. Set `API_URL`, `ACCORD_DRAFT_ID`, `ACCORD_ALLOCATION_ID`, `ACCORD_AGENT_PRIVATE_KEY`, and `ACCORD_SEPOLIA_RPC_URL` privately. It prints a review link and waits for approval, retrying the same request key. A rejection or expiry submits no transaction.

The browser preserves quote/payment references per wallet and Space. After a submitted transaction, use **Retrieve the report** or its transaction hash to fetch the result without charging again. The Node client supports `ACCORD_RESEARCH_QUOTE_ID` and `ACCORD_PAYMENT_TX_HASH` for the same recovery.

## Demo-only unlink

The small red icon on the right of the World ID linked row opens the existing modal. Its disclaimer is: **Unlinking is enabled for demo purposes only and will be removed later.** Unlinking resets IDKit enrollment for rehearsal; it does not erase payment history or change the separate owner identity used by pending/issued agent approvals.

## Integration pointers

- [World Agents OIDC validation](../apps/api/src/world-agents.ts), [approval lifecycle](../apps/api/src/approvals.ts), [review UI](../apps/web/src/components/approval-review.tsx).
- [ENS issuance](../apps/api/src/namespaces.ts), [hierarchical adapter](../contracts/src/HierarchicalEnsPermissionAdapter.sol), [Space enforcement](../contracts/src/SpaceAccount.sol).
- [Payment approval gate](../apps/api/src/payment-approval.ts), [permit signing](../apps/api/src/permits.ts), [independent agent](../apps/agent-demo/src/index.ts).
- [IDKit validation](../apps/api/src/world.ts), [integration feedback](integration-feedback.md), [current implementation plan and prize mapping](ens-world-integration-plan.md).

Intercepta is excluded from this demonstration and is not a prerequisite for payments. Record a short video of success, denial and ENS revocation before submission; the implementation and transaction evidence do not substitute for that walkthrough.
