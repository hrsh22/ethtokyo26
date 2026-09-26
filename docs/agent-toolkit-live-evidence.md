# Agent toolkit: live evidence

Verified on **26 September 2026** against the production API, the official World Agents sandbox, live GitHub sources and Ethereum Sepolia. The sandbox provides event test identities; this is not a production biometric verification claim. No World identity, approval, connection or policy was inserted into the database to make these checks pass.

## Install and connect

- Package: `@accord/agent` **0.1.0**, [versioned download](https://accord.hrsh.dev/downloads/accord-agent-0.1.0.tgz), [quickstart](../packages/agent-kit/README.md).
- Installed in a clean directory outside the monorepo. CLI help, signer creation, SDK exports and generated stdio configuration worked. The downloaded Vercel artifact matched the locally tested archive: SHA-256 `51b7b8102a70e3dcceef2fae2d87dda8d7ad8a124dc9771a3c9ea49a1a18a5dd`.
- The CLI created a dedicated signer in a mode-0600 profile. Generated MCP configuration contained only absolute executable paths and a profile name.
- Agent: `toolkit-research.tokyo-team-7ba79955.accordspaces26.eth`, signer `0x43FA83BF16F0C70acD2861D82FB05863F9676Ac8`.
- [Tokyo Team allocation 2](https://accord.hrsh.dev/spaces/0x7ba799558ce5B5Dd0bA260aE47f6106de359ad0F/a/2): 100 tUSDC initial budget, 100 daily cap, 25 per payment, owner approval above 10.
- The grant went through fresh official World authentication, exact owner consent, actual ENS registration and an onchain mandate. [Grant transaction](https://sepolia.etherscan.io/tx/0xb4635ce871fc8ecb164bd0e6249b03e1b600020746163defb49b47d4f1b13a94).
- Owner acceptance created a scoped tooling connection. The installed SDK independently checked the agent/Space ENS address records and onchain mandate; it reported the exact 100 tUSDC budget.

## Purchases through stdio MCP

The installed CLI was launched as a separate stdio process by the official TypeScript MCP client **2.1.0**. Each tool invocation restarted the connector, exercising persisted profile/operation recovery. The coding assistant chose and invoked discovery, quotes, purchases, resume and result tools through this protocol harness. This is a live MCP integration check; a narrated end-user assistant recording remains a separate submission deliverable.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Tool discovery | Nine strictly described tools; no raw signing or owner-approval tool. | Official client `tools/list` against the installed CLI. |
| Routine snapshot | 1 tUSDC submitted, confirmed, and delivered real source data for three public repositories. | Quote `279f4eb0-03b1-4681-8ace-04b964a2f31e`; [payment](https://sepolia.etherscan.io/tx/0x9e7adbb7b8f5a960fdd7bad8b97b237b5cb7353e76bf691ab56ddb558960a8a0). |
| Sensitive comparison | 20 tUSDC returned `awaiting_approval`, a review URL and no transaction. Fresh authentication by the same sandbox identity and explicit owner approval allowed resumption of the same quote. | Quote `3cc0a05e-a2b5-4e8c-b27f-c38f53ecdf6a`; approval `59110f67-c286-432a-a9e5-ea6ba50773ba`; [payment](https://sepolia.etherscan.io/tx/0xe3e318cfa404a68bdcc733334d91d30ed4c6bb7fa31d30d0af3f79fb5245c2aa). |
| Restart/delivery | A restarted connector retrieved the same saved report and receipt. | Two persisted submissions and two delivered reports, with exactly two consumed forwarder nonces. |
| Owner denial | A separate 20 tUSDC request was denied while the name and budget were valid. Resume returned `denied` and a null transaction hash. | Quote `0e2d68d0-133d-496d-92cc-5d4d3f28fdd4`; approval `698ad241-669c-48c3-8a30-63b2f0aa9333`; consumed request remains false. |
| Cached approval after ENS revocation | Another 20 tUSDC quote was freshly approved. A controlled harness saved its signed permit and successfully simulated the exact payment, then revoked the actual ENS name. The identical payment failed with `InvalidEnsAuthority`. | Quote `77690359-7a40-491e-9d1c-f6bad4d62b93`; [ENS revocation](https://sepolia.etherscan.io/tx/0xe7157f384c84f340a3e88012ff308aae84ec936d2272f353adfb07389ae550b6). At block **11784183**, timestamp **1790400924**, the permit was still valid until **1790401038**. This rejection was a live RPC simulation, not a broadcast reverted payment. |
| Connector after revocation | MCP resume returned `ens_revoked`. The already-paid comparison remained retrievable through `accord_result` after restarting again. | Final balance **79 tUSDC**, forwarder nonce **2**, denied and revoked quote request IDs both unconsumed. |

The test agent remains intentionally revoked with 79 tUSDC in its allocation. Create a fresh named agent for another rehearsal. Revocation is distinct from disconnecting the tool: the former stops cached spending permissions; the latter removes access to the connection's API operations.

## Delivered research and interpretation

The paid comparison used sources collected at approximately **05:28 UTC**. It returned source URLs, up to ten releases, bounded 90-day commit coverage, README keyword evidence and explicit gaps:

| Repository | Role described by its source | Observed default-branch commits in 90 days | Reported license |
| --- | --- | --- | --- |
| [ensdomains/ens-contracts](https://github.com/ensdomains/ens-contracts) | ENS protocol contracts | 4 | MIT |
| [wevm/viem](https://github.com/wevm/viem) | TypeScript Ethereum interface | At least 100; sample truncated | GitHub API `NOASSERTION` |
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MCP server/client SDK | 96 | GitHub API `NOASSERTION` |

For a TypeScript assistant integrating Accord, these sources point to viem for Ethereum interaction and the official MCP SDK for exposing tools, with ENS contract interfaces supplying the naming integration. Their roles are complementary; commit counts do not rank quality or security. GitHub's `NOASSERTION` needs inspection of the source license, not an assumption that no license exists. The MCP repository publishes multiple packages, so a single latest-release tag is insufficient to select an SDK package version. [ENS source](https://github.com/ensdomains/ens-contracts), [viem source](https://github.com/wevm/viem), [MCP releases](https://github.com/modelcontextprotocol/typescript-sdk/releases).

Live inspection caught a substring-matching weakness: the criterion `ENS` could match `license`. The merchant now matches whole words, with a regression assertion. Existing purchased artifacts remain immutable. README evidence is still explicitly described as keyword evidence requiring source inspection.

## Public evidence overview

[Open the demo](https://accord.hrsh.dev/demo) without connecting a wallet. It publishes only the three explicitly selected comparison requests above, using a read-only endpoint and safe report fields. The page distinguishes Accord's approval records, direct Sepolia reads and historical simulation. It explains that the recorded agent is currently revoked.

On 26 September, all **13 evidence checks** passed against the live database and Sepolia, including:

- Exact payment and token-transfer logs for the approved quote, matched to its saved report and same-owner approval record.
- Active ENS authority at the denied quote's recorded block **11784159**, no payment submission, and an unconsumed request.
- Confirmed ENS revocation at **11784183**, with the cached signed payment succeeding at **11784182** and failing at **11784183** with `InvalidEnsAuthority`, **114 seconds before its permit expired**. This is a historical RPC simulation; no payment is broadcast by the evidence page.
- Current identity inactive, with **79 tUSDC** remaining.

The endpoint shares and caches checks for 45 seconds. RPC failures display unavailable checks; mismatches display failed checks. It accepts no user-supplied quote IDs and publishes no World identifier, session credential or permit signature. Ten new regression tests cover public access, fixed publication, privacy, changed payment terms, identity mismatch, missing transfer logs, consumed denied requests, RPC failure, expired historical permits, archival RPC failure and shared caching. The API suite now passes **107 tests**; the **34 web tests**, web lint, API/web type checks and production builds also pass.

## Verification and remaining submission work

- **97 API tests**, **13 agent SDK/MCP tests**, **34 web tests**, **32 chain-package tests**, and **22 Solidity tests** pass. Type checks, lint and production builds pass. The root test command initially needed the server's Foundry binary added to PATH; the actual Solidity run passed all 22 tests.
- Automated tests cover scopes, pairing replay, wrong signer/network, changed registrations, cross-allocation attempts, owner calldata at the relay boundary, concurrent relay deduplication, lost responses, denied/expired operations, exact permits and unpaid result protection. These mocked tests are separate from the real transactions above.
- The production UI was inspected at desktop and mobile sizes: quickstart, exact-purchase approval, pairing review and developer sheet. Mobile checks found and fixed a wide code-card grid and a developer button squeezing the agent name. Authenticated visual inspection used a legitimate signed demo-owner session and a read-only injected provider; transaction signing/World verification occurred separately through real API/OIDC requests.
- The database was backed up before the additive migration. Existing Spaces, allowances and World identity records were preserved. Old unscoped sessions were expired, requiring one fresh sign-in. API health and the public artifact were verified after deployment.
- Remaining: record the concise narrated journey in an end-user assistant, with the same-owner approval and denial visible; include the controlled cached-permit evidence as an appendix. A second assistant client, hosted demo agent, merchant allowlist and expanded developer dashboard remain follow-ups, not claims made by this release.
