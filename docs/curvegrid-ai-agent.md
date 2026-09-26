# Curvegrid: AI agent implementation and evidence

Accord lets a verified person delegate a revocable budget to an ENS-named agent, which can purchase services within its limits and request approval for sensitive payments.

Target: **Best AI Agent Project**. Requirements checked on **26 September 2026** against the [official Curvegrid prize page](https://ethglobal.com/events/tokyo2026/prizes/curvegrid). The brief includes payment agents and agents constrained by spending policies and human approvals. MultiBaas integration is optional. **Accord does not use MultiBaas**, so no API key or MultiBaas-specific feedback is needed for this implementation.

## Repository requirements

| Published requirement | Where to review it |
| --- | --- |
| GitHub repository with contracts, tests and documentation | [Public repository](https://github.com/hrsh22/ethtokyo26), [contracts](../contracts/src), [contract tests](../contracts/test), [API tests](../apps/api/src/toolkit.test.ts), [SDK/MCP tests](../packages/agent-kit/src/runtime.test.ts). Anonymous GitHub access was checked on 26 September. |
| One-sentence project summary | Opening sentence of the [README](../README.md). |
| Brief team introduction and social handles | [README team section](../README.md#team): Harsh Gupta, GitHub @hrsh22. |
| Clear setup and testing instructions | [Local app setup](../README.md#run-locally), [test instructions](../README.md#tests-and-demo-tools), [standalone SDK/MCP quickstart](../packages/agent-kit/README.md). |
| MultiBaas usage and feedback, if used | Not applicable; MultiBaas is not used. |

This documents the repository requirements and current implementation. Prize selection, submission-form answers and final judging remain separate.

## What the agent actually does

An external assistant connects to nine tools through Accord's local stdio MCP server. It can resolve its ENS identity, inspect the budget, discover offers, obtain an immutable quote, purchase it, and retrieve the source-linked result and receipt. A 1 tUSDC repository snapshot can execute within the approved policy; a 20 tUSDC comparison waits for the owner when the approval threshold is 10.

The assistant chooses and interprets the task. The merchant collects public GitHub metadata, releases, commit samples and README evidence. It returns sources, collection times and coverage limitations. These are real source snapshots sold by an Accord-operated test merchant; tUSDC is a test token. The deterministic Node example and protocol test client are reproducibility tools, not autonomous models.

| Responsibility | Implementation |
| --- | --- |
| Assistant tools and shared purchase runtime | [MCP tools](../packages/agent-kit/src/mcp.ts), [SDK](../packages/agent-kit/src/index.ts), [local state and locks](../packages/agent-kit/src/store.ts). |
| Owner pairing and scoped agent sessions | [Authentication](../apps/api/src/auth.ts), [connection validation](../apps/api/src/agent-connection.ts), [toolkit API](../apps/api/src/toolkit.ts). |
| Source collection, quotes and paid delivery | [Repository research](../apps/api/src/repository-research.ts), [quote/delivery API](../apps/api/src/toolkit.ts), [exact receipt matching](../apps/api/src/research-receipt.ts). |
| Same-owner approval of exact terms | [World validation](../apps/api/src/world-agents.ts), [approval lifecycle](../apps/api/src/approvals.ts), [payment gate](../apps/api/src/payment-approval.ts). |
| Spending limits, expiry and replay prevention | [Space contract](../contracts/src/SpaceAccount.sol), [contract tests](../contracts/test/SpaceAccount.t.sol). |
| Revocation checked when payment executes | [ENS hierarchy adapter](../contracts/src/HierarchicalEnsPermissionAdapter.sol), [adapter tests](../contracts/test/HierarchicalEnsPermissionAdapter.t.sol). |

The API is trusted to validate World authentication and consent before signing a permit; the contract checks that permit, financial limits and the live ENS hierarchy. The service menu is not a contract-enforced merchant allowlist. World uses the official event sandbox's test identities. No Intercepta screening is claimed.

## Reproduce and inspect

1. Open the [live app](https://accord.hrsh.dev) or [developer quickstart](https://accord.hrsh.dev/developers). Follow the [assistant purchase demo](demo-guide.md#assistant-purchase-demo) using a fresh named agent and dedicated local signer.
2. Show identity/budget discovery, the quoted report, an approval pause, the owner's exact consent, and a confirmed receipt with the purchased evidence. Also show a denied request and ENS revocation stopping further spending.
3. Inspect the [public demo overview](https://accord.hrsh.dev/demo) for the saved report, receipts and fresh evidence checks without a wallet. Review [live toolkit evidence](agent-toolkit-live-evidence.md): real 1/20 tUSDC purchases, same-owner World approval, denial, result retrieval after restart, and a live simulation rejecting a still-valid cached permit after actual ENS revocation. The recorded test agent is intentionally revoked; its profile cannot be reused as an active demo.
4. Run the [documented test commands](../README.md#tests-and-demo-tools). Isolated tests use fixtures and do not count as live integration evidence.

**Recording status:** the narrated journey in an end-user assistant is still pending. The existing protocol-level evidence is linked above; it is not presented as that video. This recording will strengthen the demonstration, although Curvegrid's published requirements do not separately mandate an MCP recording.
