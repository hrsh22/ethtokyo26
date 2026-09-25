# Local browser end-to-end testing

This is an isolated test mode, not a public Sepolia bypass. World proof verification and Intercepta responses are fixtures; wallet signatures, API authorization, ENS adapter reads, contract execution, receipts, and balances are real operations on a disposable Anvil chain. The ENS registry is also a local fixture.

## Run

Requires the normal dependencies, compiled contracts (`forge build --root contracts`), `NEXT_PUBLIC_REOWN_PROJECT_ID` in the root `.env`. The launcher creates a temporary SQLite database. No real wallet key, World credential, or Intercepta key is needed by the test services.

```bash
pnpm --filter @accord/api e2e:browser
```

1. Open `http://localhost:3001`. Check the yellow **LOCAL E2E TEST** banner.
2. Click **Connect wallet**, choose **WalletConnect** in Reown’s wallet picker, then copy the pairing link. Paste it into the password field at `http://localhost:4101` and click **Pair local wallet**. Keep the pairing link private.
3. Return to the app and **Sign in**. The control page lists public fixture addresses and the test wallet receives 1,000 ACD.
4. Choose **New Space**, enter a name, and **Create draft**. The draft opens immediately; keep **ACD · Demo token** selected and choose **Activate Space**. Other token addresses are available under **Advanced**.
5. In **Allocate**, create a person allocation to the control page's `owner` address: total 100, monthly cap 25. In **Claim**, connect World ID using **Complete test verification**, then claim 10. A subsequent claim of 20 must fail without a wallet transaction.
6. In **Allocate**, create an agent allocation of 100. Set its mandate to the same test wallet and `agent.eth`, daily cap 20, max payment 10, with expiry within 30 days. In **Agent payments**, pay the clean recipient 5 and 10. Flagged/outage recipients, payment of 11, and a further payment of 6 must fail.
7. In **Settings**, revoke the mandate; a payment of 1 must fail. Recover both allocations in **Settings**; subsequent claims must fail.
8. Disconnect the wallet, then stop the launcher with Ctrl-C. It stops its services and removes its temporary database.

Ports 3001, 4001, 4101, and 8546 must be free. The test uses Sepolia's chain ID for app compatibility, with RPC fixed to local Anvil. Services bind to loopback. The test signer accepts only the local app, that chain, SIWE login, and zero-native-value calls to existing local contracts; its random private key stays in memory. It uses the same wallet for owner, beneficiary, and agent for UI coverage; `smoke:onchain` separately checks distinct roles and unauthorized callers.

The World simulator is selected through a development-only build alias. Enabling it for a production build or public RPC fails at startup. The normal build imports IDKit and contains no simulated World dialog. The backend fixture preload requires the dedicated local port and RPC. Root `.env` and public contract configuration are not rewritten.

## Verified browser flow

Chrome extension automation completed the steps above: **12 confirmed transactions**, 10 ACD claimed, 15 ACD paid to the recipient, 985 ACD final owner balance, both allocations closed with zero remaining. All tested rejection paths submitted no transaction. Wallet session survived reload; disconnect cleared authenticated controls. API rejection messages were improved during the run.

| Check | Result |
| --- | --- |
| Chrome wallet pairing, SIWE, draft, activation, approvals, allocations | Passed |
| Simulated World enrollment, fresh claim verification, over-cap rejection | Passed |
| ENS-bound mandate, clean payments, risky recipient, provider outage | Passed |
| Per-payment cap, daily cap, revocation, recovery, closed claim | Passed |
| Separate API/contract smoke: distinct actors, missing proof/presence, replay, unauthorized setup/recovery | Passed |
| TypeScript, lint, 25 TS tests, 8 Solidity tests, production builds | Passed |
| Production/public-RPC fixture guards; production bundle excludes simulator | Passed |

Local evidence: `.codex/browser-e2e-evidence.json` stores public transaction hashes, balances, and assertions; `.codex/check-local-e2e.log` stores check output. These transactions are on the discarded local chain and have no public explorer records. Chrome functional testing passed; native macOS Chrome window attachment returned `cgWindowNotFound` on both attempts, so this run did not include native screenshot-based visual QA.

Still unverified live: real World App Selfie Check proof acceptance and Intercepta screening/payment with the pending key. The local fixtures do not establish either integration's live acceptance.

## Paid-report and decision improvements

A later run verified the new **Get report quote → Pay & get report** flow through Chrome: five successful setup/purchase transactions, a 1 ACD payment, a delivered report showing 99 ACD remaining and 19 ACD daily headroom. Risk and provider-outage attempts returned explicit reasons without submitting transactions. The report and decision panels were visually checked at desktop width and a verified 390-pixel mobile viewport; this pass successfully used Chrome extension screenshots. Evidence is in `.codex/research-browser-evidence.json`.

The expanded `smoke:onchain` also checks report withholding before payment, altered price rejection, actor binding, delivery retry, receipt reuse against another quote, an ENS ownership change, and an independent Node-agent purchase. `pnpm check` now runs 33 TypeScript tests and 8 Solidity tests. Claim period-cap failures are returned before opening World verification.

## Shared Spaces and purchase recovery

The next pass verified a public Sepolia shared page at `/spaces/<address>`, copied link feedback, confirmed allocation/mandate receipt history, and desktop plus 390-pixel mobile layout with no horizontal overflow. The public read-only page requires no wallet; the link itself grants no permissions.

In isolated Chrome testing, a fresh agent Space was created, funded, and given a mandate. Its report cost 1 ACD. Opening the shareable page automatically reopened the signed-in Space and restored the saved purchase. Both **Retrieve paid report** after navigation and **Retrieve existing payment** after a full reload delivered the same block-12 report. Transaction count stayed at five and seller balance stayed at exactly 1 ACD. Evidence: `.codex/recovery-browser-evidence.json`.

The separate onchain smoke now also checks unused-signature retry, completed-payment rejection, cached permission rejection after revocation, and public history without private World/draft metadata. The full check passes 43 TypeScript tests plus 8 Solidity tests, lint, typechecking, and production builds. Live IDKit request creation and auth smoke passed again; no human proof was fabricated. `pnpm ready:live` checks real setup without submitting transactions and reports the missing Intercepta key as pending.

## Reown wallet picker

Chrome verified the Reown AppKit picker on the normal local app: it showed WalletConnect, detected an installed browser wallet, and offered MetaMask and other wallet options. In the isolated Anvil mode, a disposable WalletConnect wallet paired through the picker, signed the API login message, opened the authenticated workspace, and disconnected through AppKit's account view. The same flow passed after the Wagmi dependency cleanup and local Multicall adjustment. No real wallet or live partner proof was used.

## Final Chrome regression

After the wallet-picker change, Chrome repeated the isolated flow: signed login, draft and Space activation, person claim with a fresh simulated World proof, an over-cap rejection, ENS-bound agent mandate, clean payments, risky-recipient and screening-outage blocks, per-payment and daily-cap blocks, a paid report, report retrieval after reopening, mandate revocation, and a blocked post-revocation payment. A fresh single-tab pass also recovered an allocation and blocked a claim against it. Public Sepolia allocations loaded in the normal app. The full `pnpm check` passed.

One WalletConnect test response was lost after a revoke had already mined. The Space UI now watches the permit's onchain consumption and refreshes its terms and activity when a wallet response is delayed. A local-only fault control deliberately withheld a mined recovery response; Chrome showed the allocation closed, the receipt in activity, and a completion notice without remaining stuck. Public evidence is in `.codex/browser-reown-final-evidence.json` and `.codex/browser-wallet-response-recovery.json`. The user's separate MetaMask extension profile could not be attached through native Computer Use (`cgWindowNotFound`); the available Chrome extension profile has Rabby but no installed MetaMask, so this check does not prove that MetaMask's own crash is fixed.

## Workspace and session regression

The local harness now uses `accord_e2e_session`; the normal app keeps `accord_session`. Cookies are shared across localhost ports, so the previous harness overwrote normal logins. With both servers running, `node scripts/smoke-session-isolation.mjs` signs two ephemeral wallets through the actual web proxies and checks that both sessions still work. It failed with a normal-app 401 before the cookie isolation fix and passes afterward. It prints no session tokens.

The frontend distinguishes wallet connection, session restoration, authentication, and API failure. Sign-in reads the cookie-backed session before showing success. Session queries are scoped to the selected wallet and rechecked on focus and periodically; draft forms retain input when a session expires and offer sign-in inline.

The workspace replaces the former landing page. Demo content is on the shared Space route, World ID is inside Claim, and the research example is collapsed inside Agent payments. Dialogs use Radix focus trapping, name-field autofocus, Escape handling, and focus restoration.

Chrome verified the redesigned flow with a disposable WalletConnect wallet: connect from a partially filled draft, SIWE sign-in, saved draft, reload restoration, deliberate session expiry, inline reauthentication, and retained draft creation. The Space tabs passed activation, allocation funding, a 10 ACD claim, an over-period-cap block, ENS mandate setup, a 5 ACD payment, a risky-recipient block, 1 ACD report purchase/delivery, revocation, a post-revocation block, and 90 ACD recovery. All 11 submitted transactions succeeded; chain assertions confirmed 900 ACD with the owner, 6 ACD with the seller, 94 ACD left in the revoked agent allocation, and the person allocation closed. Evidence: `.codex/frontend-workspace-evidence.json`.

The workspace, creation dialog, public shared Space, and authenticated overview were visually checked in Chrome, including a verified 390 px viewport with no document overflow. Name autofocus, Escape dismissal, and focus return passed. The full `pnpm check` passed 47 TypeScript tests, 8 Solidity tests, lint, typechecking, and production builds. World/Intercepta proof acceptance remains simulated in this run.

## Asset selection regression

Chrome verified the default ACD demo selection, the Advanced custom-token option, and switching back to ACD. Opening Advanced preserves the selection; a custom selection stays visible when Advanced is collapsed. Malformed, zero, and ordinary wallet addresses disable activation. A valid token resolves its symbol before activation.

The form passed desktop and 390 px mobile checks without horizontal overflow. One local activation succeeded through Reown WalletConnect; the contract’s immutable asset matched the selection and the Space remained active after reload. Evidence: `.codex/activation-browser-evidence.json`. Web typechecking, lint, and production build passed. A read-only check also confirmed the normal Sepolia demo asset supports the new metadata checks; no public transaction was submitted.

## Smart-wallet activation and save recovery

A real MetaMask EIP-7702 activation succeeded on Sepolia but the API rejected it because the top-level transaction targeted an executor rather than the Space factory. Receipt validation now checks success, the canonical factory’s owner-bound `SpaceCreated` event, and the deployed immutable configuration. It supports internal factory calls without trusting a relayer’s identity. Twelve receipt regression cases cover direct and wrapped calls, untrusted events, ambiguous deployments, reverts, and configuration mismatches. The original receipt was revalidated and its existing draft recovered without another public transaction.

Activation now stores the public transaction hash per wallet and draft before waiting for confirmation. Failed saves offer **Finish activation** and survive reload; that action submits no new transaction. The API returns the same saved Space when the owner retries the same receipt. The integration smoke checks repeat requests, rejection of another owner, and rejection of a replacement receipt.

Chrome testing blocked the activation-save request after one successful local transaction, reloaded and reopened the draft, retried while still blocked, then unblocked and finished activation. The transaction count stayed at one. The recovered public Sepolia Space also loaded correctly. Evidence: `.codex/activation-retry-browser-evidence.json`; local recovery record: `.codex/savings-activation-recovery.json`. API/web typechecks, 41 API/web tests, web lint/build, and the full local onchain integration smoke passed.
