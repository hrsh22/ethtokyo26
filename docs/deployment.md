# Deployment

The API runs on this machine as the `accord-api` user. Nginx sends
`https://accord-api.hrsh.dev/*` to `127.0.0.1:4000/*`, and Cloudflare proxies
the API hostname. The Vercel web app sends `/api/*` to that HTTPS hostname using
the rewrite in `apps/web/next.config.ts`. The browser uses the web hostname for
its session cookie.

## API on this machine

The shared checkout is `/home/accord-api/app/ethtokyo26`. Its root `.env` is
private to the server. Keep `WEB_ORIGIN=https://accord.hrsh.dev`,
`API_PORT=4000`, and `DATABASE_FILE=../../.data/accord.sqlite`. The PM2
configuration in `ecosystem.config.cjs` sets production mode, binds the API to
loopback, and runs exactly one process for SQLite. PM2 startup is enabled for
the `accord-api` user, and `pm2 save` persists its process list across reboots.

After editing API code or `.env`, deploy from the same checkout:

```bash
sudo -iu accord-api
cd /home/accord-api/app/ethtokyo26
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$HOME/.foundry/bin:$PATH"
pnpm install --frozen-lockfile
pnpm exec turbo build --filter=@accord/api
pnpm --filter @accord/api db:migrate
pm2 restart ecosystem.config.cjs --update-env
pm2 save
curl --fail http://127.0.0.1:4000/v1/health
curl --fail https://accord-api.hrsh.dev/v1/health
```

Run `pm2 logs accord-api` to inspect errors. Back up `.data/accord.sqlite`
before migrations or manual data changes. Keep the API at one PM2 instance.
Set `FORWARDER_ADDRESS=0x947f24d2749f00be27062cec447457cac3c7a6e0`, `SPACE_FACTORY_ADDRESS=0x2C080f4EAEB124E07c50F6b9324fAb7894E97A63`, `DEMO_TOKEN_ADDRESS=0x06729abbe1b9683ea3d5addd151c15c93be2a0a4`, and `RESEARCH_PRICE_BASE_UNITS=1000000` in root `.env`. Put a separate funded Sepolia wallet key in `SPONSOR_PRIVATE_KEY` there only. Its address is `0xBf40A6E6C25fED59B18cDCC8C60692E68bCf0CBb`; top it up with Sepolia ETH when needed. `NEXT_PUBLIC_DEMO_SPACE_ADDRESS` now comes from API config, so set the new tUSDC demo Space in the backend `.env` only. The app accepts only the current tUSDC factory and token. Old ACD contracts remain on Sepolia but are no longer listed or actionable here.
The existing Nginx site has a Let's Encrypt origin certificate; Cloudflare can
use **Full (strict)** TLS for this hostname.

### Sponsor balance

Space creation uses Sepolia ETH from `0xBf40A6E6C25fED59B18cDCC8C60692E68bCf0CBb`. Refill this address with **Sepolia ETH**, including a buffer for repeated deployments; tUSDC cannot pay network fees. The API requires the estimated execution gas at the current maximum fee plus `SPONSOR_MIN_BALANCE_WEI` (default 0.001 ETH). It uses the same fee caps when submitting the transaction.

If the reserve check fails, the API returns `SponsorUnavailable` with reason `insufficient_balance`; no transaction is submitted. PM2 logs include a `sponsor_low_balance` event with the public sponsor address, balance and required wei. A saved Space draft can be deployed again after replenishment.

`pnpm dev` can reuse this API, but browser sign-in from `localhost:3000` is
rejected while `WEB_ORIGIN` is set to the production hostname.

## Web on Vercel

### Agent toolkit rollout

Migration `0005` adds scoped connections, one-time signer pairing and durable research operations. It expires pre-migration sessions because older agent credentials were not distinguishable from browser credentials. Users sign in once again; Spaces, allowances, World identities and onchain budgets are preserved. Back up SQLite before applying this additive migration. No contract replacement or Vercel environment change is required.

`GITHUB_RESEARCH_TOKEN` in the backend `.env` is optional for a higher GitHub public API rate limit. Without it, source rate limits stop new quotes before payment. `RESEARCH_SELLER_ADDRESS` remains the merchant recipient. The old `RESEARCH_PRICE_BASE_UNITS` controls the legacy Space report; toolkit offers have fixed test prices of 1 and 20 tUSDC.

Build the toolkit and refresh the versioned public artifact when releasing a new version:

```bash
pnpm --filter @accord/agent build
cd packages/agent-kit
pnpm pack --pack-destination ../../apps/web/public/downloads
```

Keep the package version, public download path and setup instructions in sync. Check installation outside the workspace before pushing. This is a versioned tarball distribution, not an npm publication. The MCP connector runs on the developer's machine, not in Vercel or the API process.

### Frontend project settings

Commit and push the deployment changes before importing the GitHub repository
as one **Next.js** project. Set its Root Directory
to `apps/web`, with **Include source files outside the Root Directory** enabled
for workspace packages. Use Node.js **24.x**.
Keep Vercel's detected Turbo Build Command, Output Directory, and Install Command;
Turbo builds the web app's workspace dependencies first. Add these
environment variables for Production before the first deployment:

| Variable | Value |
| --- | --- |
| `API_URL` | `https://accord-api.hrsh.dev` |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |
| `NEXT_PUBLIC_CHAIN_ID` | `11155111` |
| `NEXT_PUBLIC_SEPOLIA_RPC_URL` | A working Sepolia HTTPS RPC, such as `https://ethereum-sepolia-rpc.publicnode.com` |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | The Reown project ID used locally |

The root `package.json` pins pnpm 11.22.0. Corepack tells Vercel to use that
version; check the install log if Vercel falls back to an older pnpm. The chain
build compiles the checked-in `packages/chain/src/generated.ts` ABI without
requiring Foundry on Vercel. After changing a contract, run
`pnpm --filter @accord/chain generate` and commit that file before deploying.
`turbo.json` passes `API_URL` and the public browser variables into the web
build and includes them in its cache key.

Add `accord.hrsh.dev` as the Vercel production domain, then create the DNS
record Vercel specifies in Cloudflare. Use **DNS only** for this frontend
hostname; Vercel advises against stacking Cloudflare's proxy in front of its
edge. Keep Cloudflare proxying `accord-api.hrsh.dev` separately. Only the exact
`https://accord.hrsh.dev` origin is allowed for browser sign-in; Vercel preview
hostnames cannot sign in through this production API.

After deployment, open `https://accord.hrsh.dev/api/v1/health`. It must return
`{"status":"ok","chainId":11155111}`. Check wallet sign-in and a shared
Space page from the production hostname.

## ENSv2 and World Agents

Current deployment: [public manifest](../deployments/ens-world-sepolia.json).

- Parent name: `accordspaces26.eth`
- Parent subregistry: `0xaE03e5D400faF51CB57acc326CD3412c12fE71a5`
- Hierarchical adapter: `0x6462eCB827CE2596b7F926664166C25819813eaf`
- New Space factory: `0x2C080f4EAEB124E07c50F6b9324fAb7894E97A63`
- tUSDC and trusted forwarder remain at the addresses above.

The server environment sets `ENS_NAMESPACE_NAME`, `ENS_NAMESPACE_REGISTRY`, and `ENS_ADAPTER_ADDRESS`. `ENS_REGISTRAR_PRIVATE_KEY` may be a dedicated key; otherwise `DEPLOYER_PRIVATE_KEY` operates the namespace. Fund this operator and `SPONSOR_PRIVATE_KEY` with Sepolia ETH. No additional Vercel variables are needed for agent approvals.

Space activation now registers its ENSv2 name and a resolver pointing to the Space contract, before marking setup complete. This applies to Spaces for people as well as agents. Agent authorization later registers a child name. If ENS registration fails, the saved deployment transaction can be resumed with **Finish setup**; the Space contract is not deployed again.

For Spaces activated before this change, run `apps/api/scripts/backfill-space-names.mts` from `apps/api` with the root environment. It defaults to a dry run. Pause the API before adding `--broadcast` so both processes cannot use the registrar at once, then restart the API. The script preserves existing names and agent revocations and resumes confirmed deployments on retry.

World Agents uses `WORLD_AGENTS_CLIENT_ID`, `WORLD_AGENTS_ISSUER`, `WORLD_AGENTS_REDIRECT_URI`, `WORLD_AGENTS_TOKEN_ENDPOINT_AUTH_METHOD=private_key_jwt`, `WORLD_AGENTS_PRIVATE_KEY_PATH`, and `WORLD_AGENTS_KEY_ID`. Keep the PEM and all backend credentials private. The registered callback is `https://accord-api.hrsh.dev/v1/approvals/world/callback`; Nginx disables access logging for this exact path so authorization codes do not enter request logs.

Migration `0004` adds private owner identities, immutable review requests, OAuth attempts, namespace deployment recovery, and confirmed agent policies. Keep one PM2 process: issuance, decisions and registrar writes are serialized within it. Multiple workers would require distributed locking.

The pre-migration database and `.env` are saved privately in `.data/before-ens-world-20260925T195101Z/`. On 25 September 2026 the old application rows were cleared after backup. Restoring those rows also requires the old environment and application revision; old Spaces use immutable adapters and cannot be upgraded by changing `.env`.

For repeatable infrastructure deployment, compile contracts first and run `apps/api/scripts/deploy-ens-world.mts` with the root environment. Its default is a dry run; `--broadcast` resumes the public deployment manifest. The private ENS commitment secret is stored outside the repository. Do not remove the deployment manifest between retries.
