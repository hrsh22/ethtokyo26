# Integration feedback

Developer observations from the Accord build. [Live ENSv2 and World Agents results](ens-world-live-evidence.md) distinguish provider testing from isolated fixtures.

## World IDKit

- **Trust moment:** a wallet claims its assigned funds. The fresh, claim-bound Selfie Check session is intended to confirm presence and continuity of the person enrolled to that wallet. The wallet and allocation establish entitlement; we do not claim legal identity, family relationship, or death verification.
- **Credential choice:** Selfie Check sessions fit continuity without requesting passport attributes. We have not implemented a global one-per-human benefit or used the Sybil score for eligibility.
- **First success:** app/RP setup and real IDKit request construction succeeded. Time to the first complete real Selfie Check is still pending; local fixture verification is not counted as a partner success.
- **Friction:** wallet pairing cancellation/storage and returning-user session setup required extra investigation. Server checks must bind the nonce, saved session, credential, environment, signal, presence, and replay record to the exact action.
- **Most useful improvement:** one complete current React + Node example covering enrollment, returning-user action-bound sessions, presence, cancellation, and server verification.
- **User feedback:** not collected yet. During the real test, record whether the user understands why verification is requested, time to completion, cancellation/retry behavior, and any camera or World App handoff friction.

## World ID for Agents

- **Implemented:** official sandbox OIDC code flow with S256 PKCE, `private_key_jwt`, pinned issuer/JWKS, nonce, audience, signature, `auth_time`, Orb ACR and `amr: pop` validation. The first delegation binds the owner; subsequent grants/increases and sensitive payments require the same subject and fresh authentication plus explicit consent.
- **First success:** client registration completed on 25 September 2026; the first live sandbox authentication completed at 19:57:42 UTC. A subsequent fresh authentication by the same identity and explicit owner consent completed a 20 tUSDC payment. Changing the nonce caused a real provider token to be rejected. [Transaction and request evidence](ens-world-live-evidence.md).
- **Friction:** IDKit app/RP credentials and World Agents OIDC credentials belong to separate systems. Portal management requires its own MCP OAuth scope and human consent. The callback reaches the API hostname, while the wallet cookie belongs to the frontend; requests must retain the initiating session server-side.
- **Most useful improvement:** an end-to-end wallet-session + OIDC step-up example showing private-key client authentication, cancellation, exact-action consent, and callback session continuity across frontend/API domains.
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
