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
Set `FORWARDER_ADDRESS=0x947f24d2749f00be27062cec447457cac3c7a6e0`, `SPACE_FACTORY_ADDRESS=0x3ccbb42840e290e38f4f10040e08140179dfa0a9`, `DEMO_TOKEN_ADDRESS=0x06729abbe1b9683ea3d5addd151c15c93be2a0a4`, `SPACE_LEGACY_FACTORY_ADDRESSES=0xb1a653a68fcd2de8a7448db391d7de68f49cef3f`, and `RESEARCH_PRICE_BASE_UNITS=1000000` in root `.env`. Put a separate funded Sepolia wallet key in `SPONSOR_PRIVATE_KEY` there only. Its address is `0xBf40A6E6C25fED59B18cDCC8C60692E68bCf0CBb`; top it up with Sepolia ETH when needed. `NEXT_PUBLIC_DEMO_SPACE_ADDRESS` now comes from API config, so set the new tUSDC demo Space in the backend `.env` only. The sponsor will not pay fees for old ACD Spaces.
The existing Nginx site has a Let's Encrypt origin certificate; Cloudflare can
use **Full (strict)** TLS for this hostname.
`pnpm dev` can reuse this API, but browser sign-in from `localhost:3000` is
rejected while `WEB_ORIGIN` is set to the production hostname.

## Web on Vercel

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
