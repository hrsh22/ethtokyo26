# Verified people delegating revocable budgets to ENS-named agents

**Status:** implemented and deployed. Live World sandbox authentication, approved payment, denial, ENS revocation and cached-permit rejection are verified. See [live evidence](ens-world-live-evidence.md) and [deployment details](deployment.md#ensv2-and-world-agents). A narrated submission video remains to be recorded.

**Updated:** 25 September 2026. This is the current implementation plan and supersedes [the earlier payment-approval proposal](world-agents-approval-plan.md).

## The journey we are building

**Accord lets a verified person delegate a revocable budget to a named agent.** These are the four product requirements this plan implements:

1. **The person establishes their World ID identity.** Creating or increasing an agent's authority requires that same person's fresh verification.
2. **The Space issues an ENSv2 agent subname**, such as `research.team.eth`. The namespace controls registration, expiry, and revocation. The agent receives limited permissions; the Space contract enforces spending limits.
3. **The agent spends within its budget.** Sensitive payments pause for the verified owner to review the exact amount and recipient, then approve through the official World ID for Agents environment.
4. **Both controls remain necessary.** Human approval cannot rescue a revoked agent identity, and a valid ENS name cannot bypass required human approval.

The central demo is **agent requests payment → human approves → payment succeeds → revoke its ENS authority → the next payment fails**. A separate rejection while ENS authority is valid must also prevent payment.

The interface should make this relationship clear through names, status, and actions. Keep explanatory copy short and use the existing cards, pills, icons, and confirmation modals.

| Point | User experience | Required enforcement |
| --- | --- | --- |
| 1. Human-approved agent authority | Verify with World ID when granting or increasing an agent's authority. | Fresh verification and explicit consent are bound to the exact delegation. |
| 2. Visible ENSv2 agent identities | Each Space has a namespace; its agents have recognizable, expiring subnames. | Live registration, ownership, expiry, and registration version determine eligibility. |
| 3. Approval for sensitive payments | Routine spending is automatic within limits; larger requests appear in the owner's approval inbox. | A protected payment receives no permit until its exact amount and recipient are approved. |
| 4. Both controls apply together | Revoked identities stop working, even if a payment was approved. | Human approval cannot override ENS revocation or spending caps; ENS validity cannot replace required approval. |

## Prize targets and evidence

Checked against the Tokyo 2026 sponsor briefs on 25 September 2026. The two primary targets are **Best Use of ENSv2** and **Best Use of World ID for Agents**.

| Prize | How this journey addresses it | Evidence to prepare |
| --- | --- | --- |
| **ENS — Best Use of ENSv2: $6,000 pool** | Points 2 and 4 make Sepolia subnames, scoped permissions, expiry, and revocation control real agent spending. | Deployed namespace/registry addresses, a functioning agent name, restricted permissions, successful spending followed by rejection after ENS revocation, public source, and a live demo. |
| **World — Best Use of World ID for Agents: $5,000 pool** | Points 1, 3, and 4 use the official event environment at delegation and payment-approval moments, with backend validation. | Request → human completion → validated result → protected action, plus a denied/expired/cancelled case where the action does not occur; an integration debrief. |
| **World — Best Use of IDKit: $5,000 pool; supporting submission** | The existing beneficiary claim flow remains a separate IDKit use case. OIDC owner authentication alone does not satisfy this track. | A working claim proof verified on the backend, a justified credential choice, success and an alternative path, and a debrief. |

Sources: [ENS prize requirements](https://ethglobal.com/events/tokyo2026/prizes/ens), [World prize requirements](https://ethglobal.com/events/tokyo2026/prizes/world).

Prioritize the unified ENS/Agents journey. An IDKit submission depends on demonstrating the existing claim flow; it does not add a second identity check to every agent approval. Continuity-only awards require separate event eligibility and are not assumed here.

The World event environment currently uses mocked proofs. Demonstrate its real authentication/validation flow, and describe the resulting identities as sandbox identities. Registration alone, a generic login screen, or local success fixtures do not establish a completed Agents integration. [World event brief](https://ethglobal.com/events/tokyo2026/prizes/world)

### Scope decisions

- Sepolia and the existing six-decimal **tUSDC** only. Keep the repeatable 1,000 tUSDC faucet and sponsored transaction flow.
- Intercepta is outside this plan and must not block this demo. Remove the screening prerequisite from the selected payment path during implementation, including its final signing/database checks. Do not manufacture a successful screening verdict.
- Preserve beneficiary allowances: the assigned beneficiary still completes a fresh IDKit claim check. An owner linking World ID does not gain access to another beneficiary's allocation. An owner intentionally allocating their own funds to themselves is allowed.
- Keep the demo unlink action, with the disclaimer below. Do not add a large unlink button, a redundant “Check again” action, wallet-address clutter, or repeated gas sponsorship copy.
- Contract replacement and demo database cleanup were explicitly authorized; the previous database and environment were backed up before the switch.

## Starting point

| Area | Already present | Work still needed |
| --- | --- | --- |
| Beneficiary identity | IDKit enrollment and fresh claim proofs bound to permit digests. | Keep this flow intact and distinguish it from owner authentication. |
| Agent spending | Owner-issued mandates, allocation limits, permit signatures, and live ENS checks in `SpaceAccount.pay`. | Require human approval when authority is granted/increased and when a payment meets the sensitive-payment rule. |
| ENS | Adapter checks registered status, expiry, owner, and expected registration resource. | Space namespaces, subname issuance/revocation, permission configuration, hierarchy-aware resolution, and visible identity UI. |
| Owner authentication | World Agents sandbox client registered with the exact callback and public signing key. | OIDC endpoints, identity binding, freshness validation, consent, and approval persistence. |
| Payments | Short-lived permits and idempotent request keys. | Separate pending approvals from permits; enforce approval on new and reused signatures. |

### World Agents setup is complete

The backend `.env` at `/home/accord-api/app/ethtokyo26/.env` now contains:

- `WORLD_AGENTS_CLIENT_ID`
- `WORLD_AGENTS_ISSUER`
- `WORLD_AGENTS_REDIRECT_URI`
- `WORLD_AGENTS_TOKEN_ENDPOINT_AUTH_METHOD`
- `WORLD_AGENTS_PRIVATE_KEY_PATH`
- `WORLD_AGENTS_KEY_ID`

The issuer is `https://sandbox.auth.world.org`, the callback is `https://accord-api.hrsh.dev/v1/approvals/world/callback`, and client authentication uses **`private_key_jwt`**. The key stays in a private server file readable by the backend user. A `WORLD_AGENTS_CLIENT_SECRET` is not required. Keep these credentials separate from the existing IDKit app/RP configuration; do not add them to Vercel public environment variables.

Registration is complete; a successful user authentication and protected payment still need to be demonstrated.

## 1. The person establishes their World ID identity

### Intended flow

1. The signed-in person establishes an owner identity with World ID for Agents. Accord binds the backend-validated identity to their wallet session. This can happen in the first delegation flow, without a separate onboarding page.
2. The Space owner chooses an agent wallet, a subname, total funding, daily cap, per-payment cap, expiry, and an owner-approval threshold.
3. Accord creates an immutable delegation request and shows those terms for review.
4. The owner completes fresh verification as the same person. For first-time setup, perform enrollment after the request is created so that one fresh verification can establish identity and satisfy that request.
5. Accord validates the result and requires an explicit **Authorize agent** action.
6. Accord provisions the ENS identity and issues the permit for exactly the approved mandate. The UI tracks provisioning and transaction confirmation so a retry can resume safely.

Initial grants, changing the agent or identity, raising caps, extending expiry, increasing the approved spendable budget, or lowering the approval threshold require fresh approval. Owners must be able to reduce/revoke authority without completing World authentication. Keep recovery of unspent funds available under the existing ownership rules.

### Backend requirements

- Bind the owner wallet to a validated `(issuer, subject)` at first approval. Subsequent approvals must authenticate the same subject for that wallet's current identity generation.
- Existing IDKit enrollment is not an OIDC identity. Do not silently treat either credential as the other or imply they prove the same person without an explicit supported binding.
- Use authorization code flow with S256 PKCE, server-held state and nonce, `openid`, and fresh authentication (`max_age=0`/the documented fresh-login controls). Verify JWT signature, issuer, audience, expiry, nonce, authentication time, and the required authentication class. Token issuance time is not proof of fresh presence.
- Bind each attempt to the request ID, exact terms, owner/session, and expiry. A late callback cannot revive a denied, cancelled, expired, or superseded request.
- The app's session cookie is used through the frontend API rewrite. Do not assume a callback on `accord-api.hrsh.dev` receives the frontend hostname's cookie. Keep the initiating session binding server-side, redirect to a fixed Accord review URL, and require that same authenticated owner session to finish approval.
- World authentication establishes identity/presence. The separate Accord confirmation records consent to the displayed delegation.
- Gate the existing `admin.setMandate` route as well as any new endpoint. Editing limits, calling the SDK directly, or using the sponsor route must not bypass the approval requirement.

### Contract checkpoint: budget increases

The current `fundAllocation` is owner-only but needs no backend permit and does not change `policyVersion`. If total spendable agent funding is part of the approved terms, checking only the UI would leave a bypass. Add a permit-bound path for increasing agent funding, or enforce an approved cumulative spending ceiling that deposits cannot increase. Choose and test this before declaring grants fully protected; ordinary beneficiary funding can retain its existing behavior.

**Acceptance:** no grant or increase executes without matching fresh approval; changing any reviewed field invalidates it; rejected or cancelled authentication issues no permit. Restrictive actions remain available.

## 2. The Space issues an ENSv2 agent subname

### Namespace and permissions

Give each Space a real child registry under an Accord-controlled Sepolia ENSv2 parent. A name such as `research.tokyo-team.<accord-parent>.eth` illustrates the structure; the actual parent must be registered and the displayed name must resolve to deployed state.

- Issue each agent a subname bound to its wallet, Space, and expiry. Bind the mandate to the concrete registry, name ID, and registration resource observed onchain.
- Configure ENSv2 permissions so the owner retains revocation control and the agent cannot transfer its identity, renew itself, replace the resolver, or acquire registry administration. Any delegated metadata editing must be limited to specifically allowed records.
- Define who holds each registry role and how authorized writes are sponsored. Paying gas alone grants no registry authority. Document any privileged backend registrar role as part of Accord's trust model.
- Use a permissioned resolver for identity metadata such as the Space reference and agent purpose. Metadata is descriptive; it cannot expand the contract's spending limits.
- Expiry and revocation must work through actual registry state. Re-registering the same text label must not restore a mandate bound to the old registration.

ENS documents hierarchical registries and separately scoped registry/resolver permissions. Pin the implementation versions, ABIs, deployment addresses, and role constants before provisioning; the repository's existing deployment must not be assumed to match the latest documentation. [Permissioned Registry](https://docs.ens.domains/ensv2/permissioned-registry/), [Enhanced Access Control](https://docs.ens.domains/ensv2/enhanced-access-control/), [Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver/)

### Make ENS visible in the product

ENS should be recognizable throughout the main journey. Give the real namespace and agent name visual priority, show a compact **ENSv2** label on the identity details, and connect the revocation action to the permission that stops spending. A judge should be able to identify ENS's contribution from the application itself.

| Surface | Planned change |
| --- | --- |
| Space header | Show the Space namespace with a compact **ENSv2** pill and a details/explorer link. |
| Agent setup | Enter an agent label and wallet; preview the full subname beside the budget terms. |
| Agent allocation | Lead with the ENS name, then status, remaining budget, daily/per-payment limits, expiry, and approval threshold. Keep raw addresses in secondary details. |
| Approval inbox/review | Identify the requesting agent by its verified full name and show its Space and exact payment terms. |
| Activity | Use the same identity for grant, approval, payment, expiry, and revocation events. |
| Owner controls | Provide **Revoke agent** with a compact confirmation. Report pending and confirmed state accurately. |

Use short, concrete copy such as **Agent identity**, **ENSv2**, **Active until…**, and **ENS identity revoked**. After revocation, show why payment is unavailable beside that same identity. Keep addresses, registry resources, and transaction hashes in expandable details. Match the app's existing visual style; avoid adding explanatory paragraphs or a separate promotional section.

### Resolution and execution checks

`ens.ts` currently only accepts two-label `name.eth` inputs, and `admin.ts` trusts one configured registry. Extend both to resolve and validate the managed hierarchy. Caller-supplied registry addresses or display names must never be treated as proof that an agent belongs to a Space.

The current adapter validates the leaf registration only. Test parent expiry, parent reassignment, and a detached/replaced subregistry explicitly. If these operations should invalidate the displayed identity, enforce that hierarchy binding at execution too; an API-only check cannot stop a previously signed permit. Update the adapter/contract deployment if necessary.

**Acceptance:** the full name resolves through the real hierarchy, appears consistently in the UI, has appropriately limited permissions, and loses spending authority after expiry or revocation. Show the resulting onchain failure, including a previously issued payment permit.

## 3. The agent spends within its budget; sensitive payments pause

### Policy and interface

Use a per-agent **Require approval above** amount in tUSDC. Routine payments at or below the threshold run under the existing caps. Amounts above the threshold require owner approval, and amounts above the mandate's hard limits are rejected regardless of approval. A zero threshold requires approval for every payment.

For the demo, configure a threshold below the per-payment cap so both paths can be shown. For example: 100 tUSDC daily cap, 50 per payment, approval above 10. These are demo settings, not hard-coded application policy.

The owner sees a pending request with agent name, Space, amount, recipient, expiry, and any linked purchase. Offer **Verify with World ID**, followed by **Approve payment**, plus **Deny**. The agent sees a stable pending state and resumes the same request after approval. Preserve request state across reloads and wallet switches.

### Request lifecycle

`pending → verified → approved → permit issued → executed`

Before issuance, requests can end as `denied`, `cancelled`, `expired`, or `invalidated`. Authentication alone never advances directly to a payment permit. After issuance, track the transaction separately; a database cancellation cannot recall an already issued signature.

- Store owner, agent, Space, allocation, chain, token, amount, recipient, request/quote key, mandate fingerprint, policy version, identity generation, and expiry. Hash canonical typed fields using base-unit integers.
- Keep the pending request separate from `permitIntents`: allow up to eight minutes for review, clipped to quote and mandate expiry. Create the existing short-lived payment permit only after approval, with at most two minutes remaining and no extension beyond those dependencies.
- Reject changed payloads under the same request key. Exact retries reuse the same request and, once issued, the same permit. Do not let one approval mint multiple permits or authorize a second payment after the first permit expires.
- Recheck the live owner, mandate, ENS identity/hierarchy, budget, policy, and quote immediately before issuance. Use conditional database updates/transactions so concurrent approval, denial, unlink, and issuance cannot produce contradictory outcomes.
- Run approval enforcement before both new signing and `reusableSignedIntent`. An old SDK path or cached signature response cannot skip it.
- Preserve the onchain request/nonce consumption checks. Return typed pending/denied/expired results through the API contract and SDK so the web app and example agent can resume correctly.

**Acceptance:** a routine payment succeeds without owner interaction; a sensitive payment stays pending until fresh verification plus consent; denial, expiry, identity mismatch, quote expiry, and changed amount/recipient produce no new payment signature.

## 4. Both controls remain necessary

The payment rule is:

**valid live ENS identity + active mandate + available budget/caps + matching owner approval when required + valid unconsumed permit.**

ENS remains relevant after a human approves. Human approval remains necessary even when the agent's ENS identity is valid.

| Scenario | Expected result |
| --- | --- |
| Valid identity; routine payment within limits | Allow through the normal permit and execution path. |
| Valid identity; sensitive payment without approval | Pending; no permit. |
| Valid identity; sensitive payment with exact fresh approval | Issue one permit after rechecking all terms. |
| Revoked/expired/re-registered identity; payment already approved | Reject; approval cannot restore identity authority. |
| ENS identity revoked after a permit was issued | Contract execution rejects the cached permit. |
| Wrong owner, different World subject, changed agent, recipient, or amount | Reject and require a new valid request where appropriate. |
| Payment exceeds budget, daily cap, or per-payment cap | Reject even with human approval. |

### Enforcement boundary

World verification and explicit consent are backend checks represented by Accord's signed permit. They are not currently World proofs verified by the Space contract. The contract enforces the permit, ENS state, and financial limits. Record this authorizer trust accurately in developer documentation.

Bind the approval threshold to the confirmed mandate/policy revision. Treat lowering it as an increase in agent authority. Existing ungated mandates must be reauthorized into this model before the new flow treats them as human-approved.

Contract changes are allowed. The current Space's authorizer and adapter are immutable, so do not promise a configuration-only upgrade if new enforcement is needed. Audit funding and hierarchy behavior first, then decide whether to deploy a new adapter/factory and use fresh demo Spaces.

## Demo-only World ID unlink

Keep the existing unlink behavior and the small red icon on the right side of the linked-status row. This UI item is a short copy change in the existing confirmation modal:

> Unlinking is enabled for demo purposes only and will be removed later.

Keep the current confirmation actions and allow the linking sequence to be repeated for the demo. Do not add a large button, a second unlink screen, or a production account-recovery workflow. Preserve completed claims, payments, and replay-prevention history.

The new owner-approval flow must continue enforcing its original identity/request binding after any unlink or relink; an existing request cannot silently switch to a different person. Unlinking does not erase onchain transactions or recall issued permits. ENS/mandate revocation remains the mechanism for stopping active agent authority.

## Implementation sequence

| Step | Work | Main locations | Done when |
| --- | --- | --- | --- |
| 1 | Pin ENS deployment/permissions; audit funding and hierarchy enforcement; choose contract changes. | `contracts/src/SpaceAccount.sol`, `contracts/src/EnsPermissionAdapter.sol`, deployment scripts, `packages/chain` | Direct-call and cached-permit bypasses have a concrete tested design. |
| 2 | Add owner identities, immutable requests, OIDC attempts, namespaces, and delegation-policy records. | `apps/api/src/db/schema.ts`, `apps/api/drizzle-sqlite`, `packages/api-contract/src/index.ts`, `packages/sdk/src/index.ts` | Migrations and typed lifecycle work against an isolated database. |
| 3 | Implement World Agents authentication, callback, and request review/decision. | New approval/OIDC modules, `apps/api/src/index.ts`, `apps/api/src/world.ts` | Valid fresh authentication works; invalid/stale/mismatched/cancelled attempts cannot authorize actions. |
| 4 | Provision/manage Space namespaces and agent subnames; enforce fresh approval on grants and increases. | `apps/api/src/ens.ts`, `apps/api/src/admin.ts`, new namespace module, sponsored execution | A confirmed grant binds the approved terms to a real live ENS registration; retries resume safely. |
| 5 | Add sensitive-payment gating and remove the screening dependency from this demo path. | `apps/api/src/permits.ts`, `apps/api/src/research.ts`, SDK, `apps/agent-demo` | Both routine and approved sensitive payments settle; missing Intercepta configuration does not block them. |
| 6 | Build the visible ENS and approval UI; add the unlink disclaimer. | `new-allocation.tsx`, `owner-panel.tsx`, `allocation-screen.tsx`, Space/home screens, `pay-panel.tsx`, `research-purchase.tsx`, `world-id-card.tsx` | Desktop/mobile flows match the app's styling and survive reload, cancellation, and retry. |
| 7 | Run acceptance tests, deploy, and record the demo/evidence. | Contract/API/browser tests; `docs/demo-guide.md`, `docs/integration-feedback.md` | The complete live success and failure paths below are recorded. |

Provisioning is a resumable workflow: persist the intended name, registration transaction, confirmed resource, permit, and execution receipt. A failed World check or interrupted browser must not leave a secretly active mandate. If funding already succeeded, expose resume and recovery actions.

### Verification and rollout

- Contract tests: ownership and cap enforcement; approved funding increases; restricted ENS roles; name expiry/revocation/re-registration; parent hierarchy invalidation; cached permit failure; request/nonce replay.
- API tests: forged/expired tokens, incorrect audience/issuer/nonce, stale `auth_time`, changed subject/session, immutable payloads, concurrent decisions, quote expiry, unlink races, old endpoint bypasses, and idempotent retries.
- Browser tests: owner/agent/beneficiary separation; visible ENS names; World cancellation; pending/approved/denied requests; reconnect/reload; compact unlink modal; narrow-screen layouts.
- Validate the actual World sandbox success and failure paths. Local fixtures do not prove a live provider integration. Treat sandbox identities as event test identities in demo/developer material.
- Back up SQLite before migration. Deploy compatible API/schema changes before the Vercel UI, then verify PM2 health and the callback through the real hostnames. If contract replacements are required, verify the new factory/adapter and fresh demo data before switching the configured deployment.

## Demo and definition of done

1. Create a Space and show its ENSv2 namespace.
2. Authorize a named agent after fresh World authentication; show the resulting identity, limits, and expiry.
3. Execute a routine tUSDC payment within the threshold.
4. Request a sensitive payment. Show the owner reviewing the exact terms, verifying with World, explicitly approving, and the agent resuming to a confirmed receipt.
5. Demonstrate denial or timeout with no payment.
6. Prepare another approved request, then revoke the agent's **ENS identity through its namespace**. Demonstrate that the next payment fails even with that approval or a previously issued permit. Revoking only the Space mandate does not demonstrate ENS revocation.
7. Open the compact unlink modal, show the demo disclaimer, and repeat identity linking.

Publish a short architecture explanation mapping **World → the verified delegating person**, **ENSv2 → the agent's revocable identity**, and **Space → spending limits**. Link the live app, source, contract addresses, and transaction evidence. Update `docs/integration-feedback.md` with time to first success, integration friction, missing documentation/capability, and the most useful improvement observed during World integration.

World implementation references: the official sandbox MCP guides `oidc` and `step-up`, available through `get_idp_guide`, and the [World sandbox documentation](https://sandbox.auth.world.org/docs). Follow their current validation and freshness requirements; client registration alone is not a completed integration.
