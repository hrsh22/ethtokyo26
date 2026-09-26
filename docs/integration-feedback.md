# Integration feedback

Developer observations from the Accord build, updated on **26 September 2026**. The [submitted project and video](https://ethglobal.com/showcase/accord-9rop6), [live ENSv2 and World Agents results](ens-world-live-evidence.md), and [agent purchase evidence](agent-toolkit-live-evidence.md) accompany this debrief. Reported manual tests, application records and onchain receipts are identified separately below.

## World IDKit

- **Trust moment:** a wallet claims its assigned funds. The fresh, claim-bound Selfie Check session is intended to confirm presence and continuity of the person enrolled to that wallet. The wallet and allocation establish entitlement; we do not claim legal identity, family relationship, or death verification.
- **Credential choice:** Selfie Check sessions fit continuity without requesting passport attributes. We have not implemented a global one-per-human benefit or used the Sybil score for eligibility.
- **Time to first success:** roughly a couple of hours, based on Harsh's estimate rather than a stopwatch measurement. On 26 September 2026, Harsh completed a real phone Selfie Check and claimed 10 tUSDC in the deployed app. The [Tokyo Demo allowance](https://accord.hrsh.dev/spaces/0x6f8416df42458A700B5702bAe4c98145E80C8171/a/2) shows the [successful claim receipt](https://sepolia.etherscan.io/tx/0x1c059bfe65cd6426adb5e571131007f35dec43a463eb625398348019d204e9e4). Accord's stored claim record also shows World verification before permit signing; the receipt proves settlement, not the offchain selfie result.
- **Alternative path:** Harsh manually tested a wrong selfie. Selfie Check rejected it, and no claim went through. This is the developer's report of a live phone test; a separate recording of that rejection is not attached. Isolated fixture tests are not being counted as this live result.
- **Friction:** wallet pairing cancellation/storage and returning-user session setup required extra investigation. Server checks must bind the nonce, saved session, credential, environment, signal, presence, and replay record to the exact action.
- **Missing documentation and most useful improvement:** one complete current React + Node example covering enrollment, returning-user action-bound sessions, presence, cancellation, and server verification would have saved the most integration time.
- **User feedback:** the developer confirmed the successful claim and wrong-selfie rejection above. Broader user research and precise camera/handoff timings were not collected.

## World ID for Agents

- **Implemented:** official sandbox OIDC code flow with S256 PKCE, `private_key_jwt`, pinned issuer/JWKS, nonce, audience, signature, `auth_time`, Orb ACR and `amr: pop` validation. The first delegation binds the owner; subsequent grants/increases and sensitive payments require the same subject and fresh authentication plus explicit consent.
- **Time to first success:** roughly a couple of hours, based on Harsh's estimate rather than a stopwatch measurement. Client registration completed on 25 September 2026; the first live sandbox authentication completed at 19:57:42 UTC. A subsequent fresh authentication by the same identity and explicit owner consent completed a 20 tUSDC payment. [Transaction and request evidence](ens-world-live-evidence.md).
- **Unsuccessful paths:** denying a separate purchase issued no payment permit and made no payment. A changed nonce also caused a real provider token to be rejected. The [public demo](https://accord.hrsh.dev/demo) exposes the recorded denial and checks that its payment request remains unused onchain.
- **Friction:** IDKit app/RP credentials and World Agents OIDC credentials belong to separate systems. Portal management requires its own MCP OAuth scope and human consent. The callback reaches the API hostname, while the wallet cookie belongs to the frontend; requests must retain the initiating session server-side.
- **Missing documentation and most useful improvement:** an end-to-end wallet-session + OIDC step-up example showing private-key client authentication, cancellation, exact-action consent, and callback session continuity across frontend/API domains would have avoided the most investigation.
- **Environment:** World’s event sandbox uses mocked credentials. The implementation uses its real authentication endpoints; no sandbox identity is described as production biometric assurance.

## ENSv2

- Registered `accordspaces26.eth` under the existing Sepolia beta `.eth` registry. Space subregistries and per-agent resolvers use pinned official `UserRegistry` / `PermissionedResolver` implementations; addresses and transactions are in `deployments/ens-world-sepolia.json`.
- The backend registrar holds root roles. Space owners and agents hold their name tokens with no transfer, renewal, resolver, or admin permissions. Owners request revocation through their authenticated Space controls; this privileged operator is part of the trust model.
- `HierarchicalEnsPermissionAdapter` pins each child to its parent registration resource, owner and subregistry pointer. Every payment checks the live hierarchy and leaf. Eight new contract tests cover cached permits after revocation, parent expiry/detachment/reassignment, registration versions, and permit-bound funding.
- **Live result:** the full agent name resolved to its wallet; unauthorized token transfer, renewal and metadata changes were rejected. After actual ENS revocation, an approved cached payment reverted with `InvalidEnsAuthority` before its permit expired.
- **Friction:** deployment revisions differ; latest ABIs cannot be assumed to match the existing `.eth` registry. A never-registered name still has a derived nonzero resource, so issuance checks its expiry/history rather than `resource == 0`.
- **Most useful improvement:** a versioned example covering registrar → child registry → permissioned resolver, precise role bitmaps, and the distinctions between label IDs, token IDs and registration resources.

## Intercepta

Excluded from the current demo at the project owner’s request. Payment authorization does not call screening and does not return a fabricated screening verdict. The old parser tests remain as isolated historical code.
