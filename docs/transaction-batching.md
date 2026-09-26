# Transaction batching

New Spaces use one sponsored transaction for each complete onchain action:

| Action | Previous transactions | New transactions | Wallet signatures |
| --- | ---: | ---: | ---: |
| Create a Space, ENS registry, resolver, parent and adapter binding | 6 | 1 | 1 |
| Approve tUSDC and fund an allowance or budget | 2 | 1 | 1 |
| Register an agent resolver/name and install its mandate | 3 | 1 | 1 |
| Approve tUSDC and increase an agent budget | 2 | 1 | 1 |

World authentication and reviewing an agent's terms remain explicit steps. The initial inert budget is funded before that review; funds never grant an agent spending authority by themselves. Existing token allowances skip redundant approvals.

`AccordForwarder.executeSignedBatch` verifies one EIP-712 signature covering the ordered targets, calldata, gas limits, nonce, expiry, chain and forwarder. It consumes the same nonce sequence as single requests. Every target must trust the forwarder. Any failed call reverts the entire transaction, including token approval and nonce consumption. Native value transfers are unsupported. The sponsor validates every target/call and simulates the complete sequence before submitting it.

`NamedSpaceFactory.createNamedSpace` creates the Space and calls `SpaceNamespace` to deploy and initialize its ENS registry and resolver, register the Space name, set its parent, and bind its adapter. Registration failure reverts the deployment. Activation only verifies the resulting namespace and saves the API record; retrying activation does not redeploy anything.

Agent issuance simulates registration to obtain its ENS resource and signs a short-lived registrar authorization for those exact terms. That authorization is returned as a prerequisite call with the Space's mandate permit. The owner signs a batch containing registration and mandate installation. A failed mandate rolls back registration too. Registrar authorizations cannot change the label, agent, registry or expiry, revive a revoked name, or skip the live hierarchy checks.

## Existing Spaces

Space contracts and tUSDC have immutable trusted forwarders. The rollout retains their factory, token, adapter and forwarder addresses in explicit `LEGACY_*` allowlists. Existing budgets, World identities, ENS revocations, sessions and agent connections are preserved. The API uses each Space's adapter and the frontend uses each target's forwarder. Older installed agent clients can omit the forwarder: the API reads it from their target when legacy deployments are configured.

Legacy approval/funding calls execute atomically through Multicall3 wrapping individual `forwarder.execute` calls with `allowFailure=false`. They still require one signature per call. The deployed OpenZeppelin `executeBatch` can swallow zero-value target failures, so it is deliberately not used for atomic execution. Legacy ENS namespaces continue through their original registrar path. Create a new Space to get the full single-signature flow; existing balances are not silently migrated.

The token faucet on an older Space supplies that Space's original token. The home faucet supplies the current token. These are valueless test assets, not interchangeable ERC-20 balances.

## Verification and rollout

```sh
pnpm --filter @accord/chain generate
pnpm check
node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs apps/api/scripts/deploy-batching.mts --fork-test
```

The fork check starts local Anvil on port 18547 and uses the pinned, deployed ENS contracts. It verifies atomic Space registration, approval/funding, agent registration/mandate, rollback, replay rejection, registrar authorization, idempotent registration, and final revocation. It never broadcasts to Sepolia. The Solidity and API/frontend tests cover signature tampering, expiry, nonce ordering, scoped credentials, sponsorship allowlists, skipped approvals and wallet rejection.

Deploy the compatible API and frontend before activating new addresses. Pause the API while broadcasting infrastructure so its registrar does not compete for nonces. The deployment script is read-only by default and resumes its public manifest after interruption:

```sh
node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs apps/api/scripts/deploy-batching.mts
node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs apps/api/scripts/deploy-batching.mts --broadcast
node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs apps/api/scripts/deploy-batching.mts --broadcast --activate
```

`--activate` backs up the private environment under `.data/before-batching-*/`, adds the previous addresses to their legacy allowlists, and selects the new contracts. It does not modify the database. Restart the API with its updated environment. Deployment addresses and transaction hashes are recorded in `deployments/batching-sepolia.json`. Keep both deployment manifests; do not clear existing application data.
