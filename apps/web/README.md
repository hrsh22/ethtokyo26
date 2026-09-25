# Accord web

The Next.js app for Accord. See the [root README](../../README.md) for setup and current integration status.


## Review the Space experience

From the repository root, build the workspace dependencies, then start the isolated UI preview:

```sh
pnpm exec turbo build --filter=@accord/sdk --filter=@accord/chain
node apps/web/test/preview-space-ux.mjs
```

Open `http://localhost:3002/space-ux-preview`. The role selector covers the owner, recipient, agent, unassigned wallet, empty Space, and draft. It renders the real Space components with local RPC/API fixtures; no wallet is connected and no transactions are submitted. `PORT=3003` selects a different port.

The helper creates a temporary development-only route and removes it on exit. Stop it with Ctrl+C before running a production build. The fixtures are not part of the normal app routes.

For a UI review, check:

- Owners land in **Manage Space**; other wallets land in **My allocations** and have no owner controls.
- Claim and payment actions carry the correct allocation into the form. Claims require World ID; closed, exhausted, expired, revoked, or unauthorized allocations have no spending action.
- Personal and agent allocation forms explain the next steps. Funding an agent allocation continues to its mandate.
- **Recover & close** names the selected allocation in a confirmation dialog; cancelling restores focus to the initiating button.
- The role tabs work with arrow keys, action headings receive focus, and layouts fit desktop, 390px, and 320px widths.

`pnpm --filter @accord/web test` includes role/permission state tests. Browser fixtures validate UI flow; use the separate API browser E2E harness to verify wallet transactions and partner integrations.
