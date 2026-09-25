# ENSv2 + World Agents: live evidence

Completed on **25 September 2026**, using the deployed Accord API, the official World Agents sandbox, and real Sepolia contracts. The World sandbox uses event test identities; this is not production biometric verification. No verified identity, approval, ENS policy or payment was inserted through database fixtures.

## Demo identity

- [Live Space](https://accord.hrsh.dev/spaces/0x7ba799558ce5B5Dd0bA260aE47f6106de359ad0F): Tokyo Team
- Agent: `research.tokyo-team-7ba79955.accordspaces26.eth`
- Agent wallet: `0x649d7ab648f6A9CfF11Cf3764392094973C2Ab8c`
- [Space ENS registry](https://sepolia.etherscan.io/address/0xD3288EC3076102c8BbCECCC3d85F95523f711F49)
- [Deployment manifest](../deployments/ens-world-sepolia.json)

This agent is intentionally **revoked** after the final test. Its 79 tUSDC remainder stays in the Space; it cannot spend it. Create a new named agent for another rehearsal.

## Results

| Step | Observed result | Evidence |
| --- | --- | --- |
| Fresh World authentication for a grant | Official browser redirect and code exchange returned `world=verified`, then the owner explicitly approved the terms. First success at 19:57:42 UTC. | Private request `912ae41e-89d7-4a11-b416-da445fe6afc5`; credentials and identity subject are not published. |
| ENS identity and grant | Actual ENSv2 subname/resolver; budget 100 tUSDC, daily cap 100, per-payment cap 50, owner approval above 10. | [Grant transaction](https://sepolia.etherscan.io/tx/0xa153b88acea97e9607983e58c9d7000bfb3dcd5a1b705f96f8b91c39cb6945ae) |
| Resolution and restricted permissions | The name resolved to the agent wallet. Transfer, renewal, resolver/subregistry changes and resolver metadata edits by the agent were rejected. | Live RPC reads/simulations through `apps/api/scripts/verify-agent-ens.mts`; errors `TransferDisallowed` and `EACUnauthorizedAccountRoles`. |
| Routine payment | 1 tUSDC paid with the active identity and caps; no human payment review. | [Successful payment](https://sepolia.etherscan.io/tx/0x8325d04a4709662aa48b5e2ff1a71dd6f99e061e225e026246ae4790c95ce754) |
| Sensitive payment | 20 tUSDC initially returned HTTP 409 without a signature. Fresh authentication by the same World identity plus explicit owner consent allowed payment. | [Successful payment](https://sepolia.etherscan.io/tx/0x5e65c45c02bdc7b0657a68c1d174a880c90c2053b5f4df7d54afaae7006f65b3) |
| Owner denial | A separate 20 tUSDC request was denied while ENS remained active. The payment API returned HTTP 400 and issued no payment signature. | Private request `0625233c-25ec-4923-84ee-b120dc4a5691`. No transaction was sent. |
| Invalid World nonce | Changed the authorization URL's nonce while retaining the original server-side attempt. The official provider completed authentication, but Accord rejected its token with `world=failed`; the request remained unverified. | Private request `6739613c-48ed-4723-a609-6d25a853af63`. No authorization was issued. |
| ENS revocation | Unregistered the actual agent name after another payment had been approved and its signature saved. Subsequent API authorization was rejected. | [ENS revocation](https://sepolia.etherscan.io/tx/0xa5eb9faeb8fa715e94ad2d7731c10e2bd6ed7212706cb778d04c273977bde6fa) |
| Cached signature after revocation | Simulation returned `InvalidEnsAuthority`; a deliberately submitted cached payment reverted onchain. The mined block was before the permit expiry, ruling out expiry as the explanation. | [Reverted payment](https://sepolia.etherscan.io/tx/0xfc50aadb9fc840f139d5431939af7a449f7d89528dbf7d478a34c3baeaa755a3) |

The deliberate reverted transaction used the test agent's Sepolia ETH to produce public evidence. Normal application payments use the sponsor and stop during preflight when ENS authority is invalid.

## Verification and limits

- 62 API tests, 34 web tests, 32 chain package tests, and 22 Solidity tests passed. Type checking and API/web production builds passed.
- Desktop and mobile views were inspected against the deployed API. Browser layout inspection used the legitimate signed-in test-owner session and a read-only injected wallet provider; it did not substitute for the real signatures used by the live API driver.
- The backend is the trusted World verifier, permit authorizer and ENS registrar. The Space independently enforces permit binding, replay prevention, caps and live ENS authority. It does not verify the OIDC token onchain.
- Provider identity mismatch, cancellation, stale authentication and callback replay also have isolated protocol tests. Those fixture tests are distinct from the live sandbox results above.
- Record a narrated walkthrough before prize submission. These transactions and implementation checks are not a finished submission video.
