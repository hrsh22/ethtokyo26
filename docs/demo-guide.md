# Accord demo

**Pitch:** Give a person an allocation or an agent a budget. Every payment must prove it still has permission.

## Three-minute walkthrough

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:20 | ENS-named beneficiary and the funded Space | The owner confirms the resolved wallet. That entitlement stays fixed if the name changes. |
| 0:20–0:55 | A person completes World enrollment and a fresh claim check | The beneficiary wallet determines entitlement. Selfie Check adds enrolled-person continuity and fresh presence for this exact claim. |
| 0:55–1:45 | Agent requests a report quote, passes screening, pays, and receives the spending report | ENSv2 authority and budgets are checked before signing and again by the contract. The service releases the report only for the exact confirmed payment. |
| 1:45–2:20 | A known-risk recipient is blocked with a visible reason | Intercepta's result changes the decision. An unavailable provider also stops payment. |
| 2:20–2:45 | Revoke the mandate and retry | Confirmed revocation stops further spending. ENS transfer/expiry also invalidates the required authority. |
| 2:45–3:00 | Recover unspent funds and show the receipt | One set of financial rules covers both people and agents. |

For rehearsal, use [the isolated browser harness](browser-e2e.md). Its World, ENS registry, and Intercepta responses are fixtures and are labeled as such. For the live sponsor demonstration, use a real World App participant, the deployed ENSv2 name, and live Intercepta responses. Do not present a fixture verdict as live evidence.

## ENS and World ID together

| Participant | ENSv2 role | World ID role |
| --- | --- | --- |
| Person | Resolve a Sepolia `.eth` payment address; the owner confirms the full wallet before funding. The saved name is a setup snapshot. | Enroll the beneficiary wallet, then require session continuity and a fresh Selfie Check bound to each claim. |
| Agent | Bind the mandate to the name’s current registration owner and resource. Transfer, expiry, or revocation removes authority. | No human verification is claimed for an agent. |

For a person, choose **Give someone a budget → A person**, enter a name, choose **Look up**, and confirm the displayed wallet. ENS is checked again when preparing the creation permit. A subsequent name transfer or address-record change never redirects an existing allocation; the beneficiary wallet is fixed. A name without an Ethereum payment-address record cannot be used, even if it has an owner. Raw wallet addresses remain supported.

Use the Sepolia ENSv2 records, not mainnet records. The default Universal Resolver follows the [official Sepolia deployment](https://docs.ens.domains/learn/deployments/). The agent demo name needs a separate address record before it can also be used as a human payment name.

## Five-minute claiming demo

1. Claim 1,000 tUSDC with **Get 1,000 tUSDC** on **Your Spaces** or during **New Space** setup. You can claim again whenever the owner needs more test tokens. Accord pays Sepolia network fees for new tUSDC Spaces. Create a **new tUSDC Space**; old ACD Space records have been removed from this app.
2. Signed in as the beneficiary, choose **Link World ID** on **Your Spaces** before funding. Each subsequent claim still needs a fresh check.
3. As the owner, choose **Give someone a budget → A person**, confirm the beneficiary and choose **Every minute**, up to **10 tUSDC** each minute, for **5 minutes**. Use **50 tUSDC total** (or **Set the total**).
4. Once funding confirms, the beneficiary finds the allowance under **Shared with you** on **Your Spaces** and claims 10 tUSDC immediately. The owner can still send the direct allocation link. The ring empties and the button disables. The countdown shows the next refill; allowance refreshes after a block enters the next 60-second window.
5. Claim again after the refill. At five minutes, the allocation ends. On the allowance page, **Manage → Close** returns any remainder to the owner.

There are exactly five windows measured from the funding block, including the immediately available first window. Unused allowance does not accumulate. These are contract rules, not a browser-only timer or a World ID bypass. The general timed-allocation API accepts intervals from 60 seconds to one day and durations up to 365 days, in whole intervals. The UI offers per-minute allowances for a chosen number of minutes, and daily allowances either with no end date or for a chosen number of days (for example **1 month**, which is 30 days). Monthly allowances have no end date. Timed allowances and end dates need a Space from the scheduled factory; the form says so for older Spaces.

The factory is `0xb1a653a68fcd2de8a7448db391d7de68f49cef3f` on Sepolia, redeployed with the ENS adapter and demo token on 25 September 2026. Every Space it creates supports timed allowances. Spaces from earlier deployments are no longer trusted by the API.

## Paid report service

The service sells an **Agent spending report** for the configured demo ERC-20. It reports allocation funds, daily headroom, maximum payment, mandate expiry, and ENS authority at the payment block. This is a real chain-state report, not LLM-generated research or a production data marketplace.

Set the public `RESEARCH_SELLER_ADDRESS` and `RESEARCH_PRICE_BASE_UNITS` in root `.env`, then restart the API. The local Sepolia demo uses the existing dedicated deployer as seller and a price of 1 tUSDC. No seller signing key is needed. The browser shows the quote before payment.

The independent Node client runs the same task:

```bash
# Keep the agent key in the process environment or a local ignored env file.
# Also provide API_URL, ACCORD_DRAFT_ID, ACCORD_ALLOCATION_ID,
# ACCORD_AGENT_PRIVATE_KEY, and ACCORD_SEPOLIA_RPC_URL.
ACCORD_AGENT_TASK=research pnpm --filter @accord/agent-demo dev
```

The client logs the quote, decision, submitted transaction, and delivered report. If interrupted after submitting, rerun with `ACCORD_RESEARCH_QUOTE_ID` and `ACCORD_PAYMENT_TX_HASH` from those public references to retrieve the report without paying again. A new invocation without those references creates a new purchase.

The browser saves the latest purchase's public references per wallet and Space. Reopen the same Space after a refresh and choose **Retrieve paid report**; retrieval never submits another payment. If a wallet sent a transaction before returning its hash, paste the hash from wallet activity into **Retrieve existing payment**. Wallet transaction replacements update the saved hash. When browser storage is unavailable, keep the page open or save both references for the Node client. Keys, signatures, and World proof data are not stored in this recovery record.

## Share a Space and follow its activity

Use **Copy Space link** to share `/spaces/<address>`. The recipient sees token terms and public onchain activity before connecting; after signing in, the linked Space opens automatically. The link grants no permission. Beneficiary and agent wallet checks still apply.

**Activity & receipts** shows allocation funding, human claims, agent payments, mandate changes, and owner recovery, newest first. Each public Sepolia event links to its transaction. History loads in ranges of up to 5,000 blocks; use **Load older activity** for earlier ranges. The page labels the loaded range, and does not pretend blocked offchain requests are blockchain events.

## Switch to live checks

Run `pnpm ready:live` with the API running. It checks the API against local configuration, database tables, RPC chains, deployed code, funded demo allocations, live ENS authority, wallet gas, report seller, Reown ID format, and World configuration. If an Intercepta key is present, it also performs a live seller scan. It never funds wallets, renews a mandate, or submits a transaction. Exit 0 means automated checks passed, 2 means an external prerequisite is pending, and 1 means a setup/check failure; the redacted report is saved at `.codex/live-readiness.json`.

After adding `INTERCEPTA_API_KEY` locally, restart the API (Node's loaded environment does not automatically refresh), then rerun the command. Use `pnpm --filter @accord/api smoke:world-request` to check real IDKit request creation without completing a selfie. A preflight pass is separate from the remaining live evidence below.

## Integration pointers

- World: [browser session flow](../apps/web/src/components/world-identity.tsx), [server validation](../apps/api/src/world.ts), [action-bound claims](../apps/api/src/permits.ts).
- ENSv2: [live adapter](../contracts/src/EnsPermissionAdapter.sol), [contract payment enforcement](../contracts/src/SpaceAccount.sol), [name lookup](../apps/api/src/ens.ts), [human payment-address resolution](../apps/api/src/ens-recipient.ts).
- Intercepta: [Quick Scan call and policy](../apps/api/src/risk.ts), [pre-sign decision](../apps/api/src/permits.ts), [visible reasons](../apps/web/src/components/payment-decision.tsx).
- Agent task: [Node client](../apps/agent-demo/src/index.ts), [quote and delivery API](../apps/api/src/research.ts), [receipt binding](../apps/api/src/research-receipt.ts), [browser purchase](../apps/web/src/components/research-purchase.tsx).

The API is a trusted authorizer for offchain checks. A clean screening result means no risk reported under the configured policy; it is not a guarantee of safety. Human owners retain the disclosed ability to recover unspent allocations.

## Remaining live evidence

Complete real World verification, record a live Intercepta allow/block pair, and record the Sepolia purchase receipt. Publish the reviewed repository and hosted app, then record the walkthrough and fill in [integration feedback](integration-feedback.md). The standalone agent is a scripted client, not an LLM agent. No x402 dependency is required for this direct-payment demonstration.
