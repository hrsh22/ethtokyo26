# Owner approval for agent payments

> **Superseded:** use the [verified-person → named-agent delegation plan](ens-world-integration-plan.md), which follows the agreed journey and maps it to the ENSv2 and World ID for Agents prizes. World Agents registration is now complete with server-held signing-key authentication; Intercepta is outside the current plan. The proposal below is retained as historical context.

**Product decision:** Add **Require owner approval** when an owner creates an agent mandate. Use it for sensitive mandates, such as the report-purchasing agent; other mandates remain autonomous. An agent can propose a payment, but Accord will not issue the contract's payment permit until the current Space owner completes a fresh World ID for Agents authentication and explicitly approves that exact request in Accord.

This targets the open [Best Use of World ID for Agents](https://ethglobal.com/events/tokyo2026/prizes#world) track. It is a proposed feature, **not implemented yet**. The existing beneficiary Selfie Check uses IDKit and remains a separate flow.

```mermaid
sequenceDiagram
    participant Agent
    participant API as Accord API
    participant Owner
    participant World as World Agents sandbox
    participant Space as Sepolia Space
    Agent->>API: Propose exact payment
    API-->>Agent: Pending approval; no permit
    Owner->>API: Open request and review details
    API->>World: Request fresh authentication
    World-->>API: Authorization code
    API->>World: Exchange code and validate identity
    Owner->>API: Approve unchanged request
    Agent->>API: Resume payment
    API->>API: Recheck owner, ENS mandate, quote, risk, limits
    API-->>Agent: One short-lived payment permit
    Agent->>Space: Execute payment
```

## Implementation

1. **Policy and request.** Persist the approval-required flag against the Space/agent allocation when the owner sets its mandate. Only its authenticated onchain owner may set it. Add a SQLite `agent_payment_requests` record containing Space, allocation, agent, token, amount, recipient, request/quote key, owner address, expiry, and status. A request lasts at most eight minutes (and ends earlier if a linked quote expires); retries with the same key must match every field. Show the agent `pending`, `approved`, `denied`, or `expired`.
2. **Owner identity.** Register a separate confidential OIDC client in the [official World Agents event sandbox](https://sandbox.auth.world.org/docs), with an exact HTTPS callback. Link the current Space owner's wallet session to a validated `(issuer, subject)` once; on every approval, request fresh authentication. Keep client secret, PKCE verifier, state, and nonce on the API; exchange the code and verify signature/JWKS, issuer, audience, expiry, nonce, state, and authentication time. Reject a different subject or changed onchain owner. Sandbox identities are mocked; this is an event integration, not production identity assurance.
3. **Review and authorization.** Show the owner one clear approval screen with Space, agent/ENS name, token, amount, recipient, and expiry. After the World callback, require a separate **Approve payment** click in Accord; also offer **Deny**. Bind approval to the immutable request and consume it once. World authenticates the person; **Accord records consent to the displayed payment**. OIDC alone does not prove World displayed or approved the payment details.
4. **Payment gate.** Split the present `/v1/permits/payments` path so a protected payment cannot reach `signIntent` or a reusable signed response without a valid approval. After approval, create a fresh two-minute permit, run Intercepta screening immediately before signing, and recheck the current Space owner, ENSv2 mandate, quote, policy, limits, and exact payment fields. Keep the existing onchain permit format; no contract redeploy is expected. A quote expiring during review requires a new request.

The API's current payment intent expires after **two minutes**, while a human may need longer to authenticate. The pending approval therefore lives separately; only a newly prepared permit receives the two-minute lifetime. The existing report quote expires after **ten minutes**, so the demo request must complete within that window or restart with a new quote.

## Demo and acceptance

- **Success:** an ENSv2-named agent requests a report payment; the owner sees it as pending, completes World Agents sandbox authentication, approves the exact amount and recipient, and the agent pays on Sepolia. Show the validated backend decision and transaction receipt.
- **Failure:** cancel, deny, let the request expire, or authenticate as a different owner. The agent receives no payment permit and no payment occurs. Also show that changing the recipient or amount invalidates the request.
- **Submission:** include the required brief integration debrief: time to first success, friction, missing capability/docs, and the one most useful improvement. The [prize brief](https://ethglobal.com/events/tokyo2026/prizes#world) requires the official dev environment, backend validation, a complete protected action, and a failed path; a generic World login is insufficient.

**External prerequisites:** sandbox portal client registration, its client ID/secret, an HTTPS callback, and the still-pending Intercepta key for a live screened payment. Keep World Agents credentials separate from Accord's IDKit RP settings. Until the sandbox setup succeeds, build and test the gate and failed paths locally, but do not claim a completed Agents-track integration.
