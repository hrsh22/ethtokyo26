# Integration feedback

Developer observations from the Accord build. This separates completed engineering checks from live partner results still awaiting testing.

## World IDKit

- **Trust moment:** a wallet claims its assigned funds. The fresh, claim-bound Selfie Check session is intended to confirm presence and continuity of the person enrolled to that wallet. The wallet and allocation establish entitlement; we do not claim legal identity, family relationship, or death verification.
- **Credential choice:** Selfie Check sessions fit continuity without requesting passport attributes. We have not implemented a global one-per-human benefit or used the Sybil score for eligibility.
- **First success:** app/RP setup and real IDKit request construction succeeded. Time to the first complete real Selfie Check is still pending; local fixture verification is not counted as a partner success.
- **Friction:** wallet pairing cancellation/storage and returning-user session setup required extra investigation. Server checks must bind the nonce, saved session, credential, environment, signal, presence, and replay record to the exact action.
- **Most useful improvement:** one complete current React + Node example covering enrollment, returning-user action-bound sessions, presence, cancellation, and server verification.
- **User feedback:** not collected yet. During the real test, record whether the user understands why verification is requested, time to completion, cancellation/retry behavior, and any camera or World App handoff friction.

## Intercepta

- Time to first live call: pending the requested sandbox key; no live success is claimed.
- The Quick Scan parser, zero-score/no-traits policy, and pre-sign enforcement are implemented; clean, risky, and unavailable responses pass local fixture tests.
- The product now shows the toxic score and reported trait names, while outages pause payment without issuing a signature.
- Integration friction: documentation uses Web3 Antivirus API naming while the prize uses Intercepta; a single event-ready example with headers, response schema, network coverage, and known-risk addresses would help.
- After key delivery: record latency, a real clean and blocked decision, rate-limit behavior, and any schema differences. Keep the key out of screenshots and repository history.

## ENSv2

The Sepolia name and mandate are deployed. Authority uses registration state, owner, expiry, and resource binding rather than name display alone. The local integration test changes ENS ownership and verifies payment stops, then restores the test fixture. The next live demo should record a deliberate authority change or revocation with the before/after transaction references. A concise migration example contrasting name IDs, token IDs, and resource bindings would reduce integration ambiguity.
