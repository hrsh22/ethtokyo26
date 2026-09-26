import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

const Address = Schema.String.pipe(Schema.pattern(/^0x[a-fA-F0-9]{40}$/));
const Uint = Schema.String.pipe(Schema.pattern(/^(0|[1-9][0-9]{0,77})$/));
const Name = Schema.String.pipe(Schema.minLength(5), Schema.maxLength(255));
const Secret = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
export class ToolkitError extends Schema.TaggedError<ToolkitError>()("ToolkitError", {
  code: Schema.String, message: Schema.String,
}, HttpApiSchema.annotations({ status: 400 })) {}

export const ToolkitIdentity = Schema.Struct({
  name: Name, chainId: Schema.Literal(11155111), agent: Address, owner: Address,
  draftId: Schema.UUID, spaceAddress: Address, spaceName: Schema.String, allocationId: Uint,
  registry: Address, nameId: Uint, resource: Uint, blockNumber: Uint,
  tokenAddress: Address, adapterAddress: Address, authorizerAddress: Address, forwarderAddress: Address,
  remaining: Uint, dailyRemaining: Uint, dailyCap: Uint, maxPerPayment: Uint,
  approvalThreshold: Uint, expiry: Uint, active: Schema.Boolean,
});
export const ConnectionView = Schema.Struct({
  id: Schema.UUID, name: Name, agent: Address, spaceAddress: Address, allocationId: Uint,
  createdAt: Schema.String, expiresAt: Schema.String, lastSeenAt: Schema.NullOr(Schema.String), revoked: Schema.Boolean,
});
export const PairingView = Schema.Struct({
  id: Schema.UUID, agent: Address, name: Schema.NullOr(Schema.String), expiresAt: Schema.String,
  connectionId: Schema.NullOr(Schema.UUID),
});
export const RepositoryInput = Schema.Struct({
  operationKey: Schema.UUID,
  repositories: Schema.Array(Schema.String.pipe(Schema.minLength(3), Schema.maxLength(180))).pipe(Schema.minItems(1), Schema.maxItems(3)),
  tier: Schema.Literal("snapshot", "comparison"),
  criteria: Schema.Array(Schema.String.pipe(Schema.minLength(2), Schema.maxLength(100))).pipe(Schema.maxItems(3)),
});
export const ToolkitQuote = Schema.Struct({
  id: Schema.UUID, operationKey: Schema.UUID, agentName: Name, service: Schema.String, title: Schema.String,
  tier: Schema.Literal("snapshot", "comparison"), repositories: Schema.Array(Schema.String), criteria: Schema.Array(Schema.String),
  draftId: Schema.UUID, allocationId: Uint, spaceAddress: Address, tokenAddress: Address, recipient: Address,
  amount: Uint, expiresAt: Schema.String, collectedAt: Schema.String,
});
export const ToolkitOperation = Schema.Struct({
  quote: ToolkitQuote, status: Schema.String, transactionHash: Schema.NullOr(Schema.String),
  approvalId: Schema.NullOr(Schema.UUID), reviewUrl: Schema.NullOr(Schema.String),
  result: Schema.optional(Schema.Unknown),
});

export const ToolkitGroup = HttpApiGroup.make("toolkit")
  .add(HttpApiEndpoint.post("resolve")`/v1/toolkit/resolve`.setPayload(Schema.Struct({name: Name}))
    .addSuccess(Schema.Struct({identities: Schema.Array(ToolkitIdentity)})))
  .add(HttpApiEndpoint.post("pair")`/v1/toolkit/pair`.setPayload(Schema.Struct({name: Schema.optional(Name)}))
    .addSuccess(Schema.Struct({id: Schema.UUID, reviewUrl: Schema.String, pollToken: Secret, expiresAt: Schema.String})))
  .add(HttpApiEndpoint.post("review")`/v1/toolkit/pair/review`.setPayload(Schema.Struct({id: Schema.UUID, reviewToken: Secret})).addSuccess(PairingView))
  .add(HttpApiEndpoint.post("accept")`/v1/toolkit/pair/accept`.setPayload(Schema.Struct({
    id: Schema.UUID, reviewToken: Secret, draftId: Schema.UUID, allocationId: Uint,
  })).addSuccess(ConnectionView))
  .add(HttpApiEndpoint.post("poll")`/v1/toolkit/pair/poll`.setPayload(Schema.Struct({id: Schema.UUID, pollToken: Secret})).addSuccess(PairingView))
  .add(HttpApiEndpoint.get("identity")`/v1/toolkit/identity`.addSuccess(ToolkitIdentity))
  .add(HttpApiEndpoint.post("connections")`/v1/toolkit/connections`.setPayload(Schema.Struct({draftId: Schema.UUID, allocationId: Uint}))
    .addSuccess(Schema.Struct({connections: Schema.Array(ConnectionView)})))
  .add(HttpApiEndpoint.post("ownerOperations")`/v1/toolkit/owner-operations`.setPayload(Schema.Struct({draftId: Schema.UUID, allocationId: Uint}))
    .addSuccess(Schema.Struct({operations: Schema.Array(ToolkitOperation)})))
  .add(HttpApiEndpoint.post("disconnect")`/v1/toolkit/disconnect`.setPayload(Schema.Struct({id: Schema.UUID})).addSuccess(Schema.Struct({disconnected: Schema.Boolean})))
  .add(HttpApiEndpoint.get("services")`/v1/toolkit/services`.addSuccess(Schema.Struct({services: Schema.Array(Schema.Struct({
    id: Schema.String, title: Schema.String, description: Schema.String, tier: Schema.Literal("snapshot", "comparison"), amount: Uint,
  }))})))
  .add(HttpApiEndpoint.post("quote")`/v1/toolkit/quotes`.setPayload(RepositoryInput).addSuccess(ToolkitQuote))
  .add(HttpApiEndpoint.get("operations")`/v1/toolkit/operations`.addSuccess(Schema.Struct({operations: Schema.Array(ToolkitOperation)})))
  .add(HttpApiEndpoint.post("operation")`/v1/toolkit/operation`.setPayload(Schema.Struct({id: Schema.UUID})).addSuccess(ToolkitOperation))
  .add(HttpApiEndpoint.post("redeem")`/v1/toolkit/redeem`.setPayload(Schema.Struct({id: Schema.UUID,
    transactionHash: Schema.String.pipe(Schema.pattern(/^0x[a-fA-F0-9]{64}$/)),
  })).addSuccess(ToolkitOperation))
  .addError(ToolkitError).addError(HttpApiError.Unauthorized).addError(HttpApiError.Forbidden)
  .addError(HttpApiError.BadRequest).addError(HttpApiError.NotFound).addError(HttpApiError.ServiceUnavailable);
