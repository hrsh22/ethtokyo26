import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

export const Health = Schema.Struct({
  status: Schema.Literal("ok"),
  chainId: Schema.Literal(11155111),
});
export const SpaceTemplate = Schema.Struct({
  id: Schema.Literal("recurring-support", "research-budget"),
  mode: Schema.Literal("people", "agents"),
  name: Schema.String,
  description: Schema.String,
});

export const Catalog = Schema.Struct({
  templates: Schema.Array(SpaceTemplate),
});

export const WalletAddress = Schema.String.pipe(Schema.pattern(/^0x[a-fA-F0-9]{40}$/));
const UnsignedInteger = Schema.String.pipe(Schema.pattern(/^(0|[1-9][0-9]*)$/));

export const DeploymentConfig = Schema.Struct({
  configured: Schema.Boolean,
  factoryAddress: Schema.optional(WalletAddress),
  adapterAddress: Schema.optional(WalletAddress),
  authorizerAddress: Schema.optional(WalletAddress),
  demoTokenAddress: Schema.optional(WalletAddress),
  forwarderAddress: Schema.optional(WalletAddress),
  demoSpaceAddress: Schema.optional(WalletAddress),
  ensRegistryAddress: Schema.optional(WalletAddress),
  agentNamespace: Schema.optional(Schema.String),
});
export const ResolveEnsName = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(5), Schema.maxLength(255)),
});
export const EnsNameState = Schema.Struct({
  name: Schema.String,
  registry: WalletAddress,
  nameId: Schema.String,
  resource: Schema.String,
  owner: WalletAddress,
  expiry: Schema.String,
  active: Schema.Boolean,
});
export const EnsRecipient = Schema.Struct({
  name: Schema.String, address: WalletAddress, blockNumber: Schema.String,
  chainId: Schema.Literal(11155111),
});
export const AllocationNameRequest = Schema.Struct({
  spaceAddress: WalletAddress,
  allocationIds: Schema.Array(Schema.String.pipe(Schema.pattern(/^[1-9][0-9]{0,77}$/))).pipe(Schema.maxItems(20)),
});
export const AllocationNameList = Schema.Struct({ names: Schema.Array(Schema.Struct({
  allocationId: Schema.String, name: Schema.String, address: WalletAddress, resolvedBlock: Schema.String,
})) });

export const ChallengeRequest = Schema.Struct({ address: WalletAddress });
export const ChallengeResponse = Schema.Struct({
  id: Schema.UUID,
  message: Schema.String,
  expiresAt: Schema.String,
});
export const VerifyRequest = Schema.Struct({
  id: Schema.UUID,
  address: WalletAddress,
  signature: Schema.String.pipe(Schema.pattern(/^0x[a-fA-F0-9]{130}$/)),
  client: Schema.Literal("browser", "agent"),
});
export const SessionResponse = Schema.Struct({
  address: WalletAddress,
  expiresAt: Schema.String,
  token: Schema.optional(Schema.String),
});

export const SpaceDraft = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  templateId: Schema.Literal("recurring-support", "research-budget"),
  owner: WalletAddress,
  createdAt: Schema.String,
  spaceAddress: Schema.optional(WalletAddress),
  tokenAddress: Schema.optional(WalletAddress),
  activatedAt: Schema.optional(Schema.String),
});
export const SpaceDraftList = Schema.Struct({ spaces: Schema.Array(SpaceDraft) });
export const ReceivedAllowanceList = Schema.Struct({ allowances: Schema.Array(Schema.Struct({
  spaceAddress: WalletAddress,
  spaceName: Schema.String,
  allocationId: UnsignedInteger,
  createdBlock: UnsignedInteger,
})) });
export const CreateSpaceDraft = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(2), Schema.maxLength(80)),
  templateId: Schema.Literal("recurring-support", "research-budget"),
});
export const ActivateSpaceDraft = Schema.Struct({
  draftId: Schema.UUID,
  deploymentTx: Schema.String.pipe(Schema.pattern(/^0x[a-fA-F0-9]{64}$/)),
});
export const SponsoredRequest = Schema.Struct({
  from: WalletAddress, to: WalletAddress,
  value: UnsignedInteger, gas: UnsignedInteger, nonce: UnsignedInteger, deadline: UnsignedInteger,
  data: Schema.String.pipe(Schema.pattern(/^0x(?:[a-fA-F0-9]{2})*$/)),
  signature: Schema.String.pipe(Schema.pattern(/^0x[a-fA-F0-9]{130}$/)),
});
export const SponsoredTransaction = Schema.Struct({ transactionHash: Schema.String.pipe(Schema.pattern(/^0x[a-fA-F0-9]{64}$/)) });
export class SponsorUnavailable extends Schema.TaggedError<SponsorUnavailable>()("SponsorUnavailable", {
  reason: Schema.Literal("insufficient_balance", "service_unavailable"),
  message: Schema.String,
}, HttpApiSchema.annotations({ status: 503 })) {}
export const LookupSpace = Schema.Struct({ spaceAddress: WalletAddress });
// Public: the name an owner gave an activated Space. Drafts and other metadata stay private.
export const SpaceProfile = Schema.Struct({ id: Schema.UUID, name: Schema.String, spaceAddress: WalletAddress });

export const WorldStatus = Schema.Struct({
  configured: Schema.Boolean,
  enrolled: Schema.Boolean,
  sessionId: Schema.optional(Schema.String),
  environment: Schema.Literal("staging", "production"),
});
export const WorldUnlinkResult = Schema.Struct({ unlinked: Schema.Boolean });
export const WorldChallengeRequest = Schema.Struct({
  mode: Schema.Literal("enroll", "reverify", "claim"),
  intentId: Schema.optional(Schema.UUID),
});
export const WorldChallenge = Schema.Struct({
  id: Schema.UUID,
  appId: Schema.String,
  environment: Schema.Literal("staging", "production"),
  sessionId: Schema.optional(Schema.String),
  requireUserPresence: Schema.Boolean,
  signal: Schema.optional(Schema.String),
  rpContext: Schema.Struct({
    rp_id: Schema.String,
    nonce: Schema.String,
    created_at: Schema.Number,
    expires_at: Schema.Number,
    signature: Schema.String,
  }),
});
export const WorldVerifyRequest = Schema.Struct({
  id: Schema.UUID,
  result: Schema.Unknown,
});
export const WorldVerification = Schema.Struct({
  verified: Schema.Literal(true),
  enrolled: Schema.Boolean,
  sessionId: Schema.String,
  intentId: Schema.optional(Schema.UUID),
});

export const SpaceActivityRequest = Schema.Struct({ spaceAddress: WalletAddress,
  beforeBlock: Schema.optional(Schema.String.pipe(Schema.pattern(/^[0-9]{1,20}$/))),
});
export const SpaceActivity = Schema.Struct({
  fromBlock: UnsignedInteger, toBlock: UnsignedInteger,
  nextBeforeBlock: Schema.optional(UnsignedInteger),
  deploymentTx: Schema.String,
  events: Schema.Array(Schema.Struct({ id: Schema.String,
    kind: Schema.Literal("AllocationCreated", "AllocationFunded", "Claimed", "MandateSet", "MandateRevoked", "PaymentMade", "AllocationRecovered"),
    allocationId: UnsignedInteger, transactionHash: Schema.String, blockNumber: UnsignedInteger,
    amount: Schema.optional(UnsignedInteger), actor: Schema.optional(WalletAddress), recipient: Schema.optional(WalletAddress),
  })),
});
export const PreparePermitRequest = Schema.Struct({
  draftId: Schema.UUID,
  allocationId: UnsignedInteger,
  amount: UnsignedInteger,
  requestKey: Schema.UUID,
  recipient: Schema.optional(WalletAddress),
});
export const PermitEnvelope = Schema.Struct({
  actor: WalletAddress,
  action: Schema.Literal(2, 3),
  allocationId: UnsignedInteger,
  recipient: WalletAddress,
  amount: UnsignedInteger,
  requestId: Schema.String,
  nonce: UnsignedInteger,
  expiry: UnsignedInteger,
  policyVersion: UnsignedInteger,
  detailsHash: Schema.String,
});
export const PermitIntentResponse = Schema.Struct({
  id: Schema.UUID,
  spaceAddress: WalletAddress,
  digest: Schema.String,
  permit: PermitEnvelope,
  signature: Schema.optional(Schema.String),
  worldVerified: Schema.Boolean,
  riskVerdict: Schema.optional(Schema.Literal("allow")),
  decision: Schema.optional(Schema.Struct({
    outcome: Schema.Literal("allow"), code: Schema.String, reason: Schema.String,
    checkedAt: Schema.String, toxicScore: Schema.Number, traits: Schema.Array(Schema.String),
  })),
});
export const PaymentDecision = Schema.Struct({
  outcome: Schema.Literal("allow", "block", "unavailable"),
  code: Schema.String, reason: Schema.String, checkedAt: Schema.String,
  toxicScore: Schema.optional(Schema.Number), traits: Schema.Array(Schema.String),
});
export class DecisionRejected extends Schema.TaggedError<DecisionRejected>()("DecisionRejected", {
  decision: PaymentDecision,
}, HttpApiSchema.annotations({ status: 403 })) {}
export class ScreeningUnavailable extends Schema.TaggedError<ScreeningUnavailable>()("ScreeningUnavailable", {
  decision: PaymentDecision,
}, HttpApiSchema.annotations({ status: 503 })) {}

export const ResearchQuoteRequest = Schema.Struct({ draftId: Schema.UUID, allocationId: UnsignedInteger });
export const ResearchQuote = Schema.Struct({
  id: Schema.UUID, title: Schema.String, draftId: Schema.UUID, allocationId: UnsignedInteger,
  spaceAddress: WalletAddress, tokenAddress: WalletAddress, recipient: WalletAddress,
  amount: UnsignedInteger, expiresAt: Schema.String,
});
export const ResearchRedeem = Schema.Struct({ quoteId: Schema.UUID,
  transactionHash: Schema.String.pipe(Schema.pattern(/^0x[a-fA-F0-9]{64}$/)),
});
export const ResearchReport = Schema.Struct({
  title: Schema.String, quoteId: Schema.UUID, transactionHash: Schema.String,
  spaceAddress: WalletAddress, allocationId: UnsignedInteger, tokenAddress: WalletAddress,
  blockNumber: UnsignedInteger, generatedAt: Schema.String, remaining: UnsignedInteger,
  dailyRemaining: UnsignedInteger, maxPerPayment: UnsignedInteger, agent: WalletAddress,
  mandateActive: Schema.Boolean, ensAuthorized: Schema.Boolean, mandateExpiry: Schema.String,
});
export const SignClaimRequest = Schema.Struct({ intentId: Schema.UUID });

export const AdminCreateAllocation = Schema.Struct({
  draftId: Schema.UUID, requestKey: Schema.UUID, beneficiary: WalletAddress,
  beneficiaryEnsName: Schema.optional(Schema.String.pipe(Schema.minLength(5), Schema.maxLength(255))),
  amount: UnsignedInteger, periodCap: UnsignedInteger, period: Schema.Literal(0, 1, 2, 3),
  schedule: Schema.optional(Schema.Struct({
    intervalSeconds: Schema.Number.pipe(Schema.int(), Schema.between(60, 86400)),
    durationSeconds: Schema.Number.pipe(Schema.int(), Schema.between(60, 31536000)),
  })),
});
export const AdminSetMandate = Schema.Struct({
  draftId: Schema.UUID, requestKey: Schema.UUID, allocationId: UnsignedInteger,
  agent: WalletAddress, registry: WalletAddress, nameId: UnsignedInteger,
  expectedResource: UnsignedInteger, dailyCap: UnsignedInteger,
  maxPerPayment: UnsignedInteger, expiry: UnsignedInteger,
  // Display label only; it must hash to nameId, and authority still comes from the registry.
  agentEnsName: Schema.optional(Schema.String.pipe(Schema.minLength(5), Schema.maxLength(255))),
});
export const AdminRevokeMandate = Schema.Struct({
  draftId: Schema.UUID, requestKey: Schema.UUID, allocationId: UnsignedInteger,
});
export const AdminRecoverAllocation = AdminRevokeMandate;
export const AdminPermitResponse = Schema.Struct({
  spaceAddress: WalletAddress, tokenAddress: WalletAddress,
  functionName: Schema.Literal("createAllocation", "createTimedAllocation", "setMandate", "revokeMandate", "recoverAllocation", "fundAgentAllocation"),
  calldata: Schema.String, signature: Schema.String, digest: Schema.String,
  permit: Schema.Struct({
    actor: WalletAddress, action: Schema.Literal(0, 1, 4, 5, 6), allocationId: UnsignedInteger,
    recipient: WalletAddress, amount: UnsignedInteger, requestId: Schema.String,
    nonce: UnsignedInteger, expiry: UnsignedInteger, policyVersion: UnsignedInteger,
    detailsHash: Schema.String,
  }),
  // createAllocation transfers this amount from the owner; approve the Space first.
  approvalAmount: UnsignedInteger,
});

export const AgentGrantRequest = Schema.Struct({
  draftId: Schema.UUID, requestKey: Schema.UUID, allocationId: UnsignedInteger,
  label: Schema.String.pipe(Schema.pattern(/^[a-z0-9][a-z0-9-]{0,31}$/)), agent: WalletAddress,
  dailyCap: UnsignedInteger, maxPerPayment: UnsignedInteger,
  expiry: UnsignedInteger, approvalThreshold: UnsignedInteger,
});
export const AgentFundRequest = Schema.Struct({
  draftId: Schema.UUID, requestKey: Schema.UUID, allocationId: UnsignedInteger, amount: UnsignedInteger,
});
export const ApprovalId = Schema.Struct({ id: Schema.UUID });
export const AgentRequestView = Schema.Struct({
  id: Schema.UUID, kind: Schema.String, status: Schema.String,
  draftId: Schema.UUID, spaceAddress: WalletAddress, spaceName: Schema.String,
  allocationId: UnsignedInteger, owner: WalletAddress, agent: WalletAddress,
  agentName: Schema.String, amount: UnsignedInteger,
  recipient: Schema.optional(WalletAddress), dailyCap: Schema.optional(UnsignedInteger),
  maxPerPayment: Schema.optional(UnsignedInteger), approvalThreshold: Schema.optional(UnsignedInteger),
  expiry: Schema.optional(UnsignedInteger), expiresAt: Schema.String,
  createdAt: Schema.String, verified: Schema.Boolean,
});
export class AgentApprovalRequired extends Schema.TaggedError<AgentApprovalRequired>()("AgentApprovalRequired", {
  request: AgentRequestView,
}, HttpApiSchema.annotations({ status: 409 })) {}
export class AgentActionError extends Schema.TaggedError<AgentActionError>()("AgentActionError", {
  message: Schema.String,
}, HttpApiSchema.annotations({ status: 400 })) {}
export const AgentIdentity = Schema.Struct({
  name: Schema.String, agent: WalletAddress, allocationId: UnsignedInteger,
  registry: WalletAddress, nameId: UnsignedInteger, resource: UnsignedInteger,
  approvalThreshold: UnsignedInteger, expiry: UnsignedInteger,
  active: Schema.Boolean, confirmed: Schema.Boolean, revoked: Schema.Boolean,
});

export const AccordApi = HttpApi.make("AccordApi")
  .add(HttpApiGroup.make("approvals")
    .add(HttpApiEndpoint.get("list")`/v1/approvals`.addSuccess(Schema.Struct({
      configured: Schema.Boolean, identified: Schema.Boolean, requests: Schema.Array(AgentRequestView),
    })))
    .add(HttpApiEndpoint.post("get")`/v1/approvals/get`.setPayload(ApprovalId).addSuccess(AgentRequestView))
    .add(HttpApiEndpoint.post("authenticate")`/v1/approvals/world/start`.setPayload(ApprovalId).addSuccess(Schema.Struct({ url: Schema.String })))
    .add(HttpApiEndpoint.get("worldCallback")`/v1/approvals/world/callback`.setUrlParams(Schema.Struct({
      state: Schema.optional(Schema.String), code: Schema.optional(Schema.String), error: Schema.optional(Schema.String),
    })).addSuccess(Schema.Void))
    .add(HttpApiEndpoint.post("decide")`/v1/approvals/decide`.setPayload(Schema.Struct({
      id: Schema.UUID, decision: Schema.Literal("approve", "deny", "cancel"),
    })).addSuccess(AgentRequestView))
    .addError(HttpApiError.Unauthorized).addError(HttpApiError.Forbidden).addError(HttpApiError.NotFound)
    .addError(HttpApiError.ServiceUnavailable).addError(AgentActionError))
  .add(HttpApiGroup.make("agents")
    .add(HttpApiEndpoint.post("prepare")`/v1/agents/prepare`.setPayload(AgentGrantRequest).addSuccess(AgentRequestView))
    .add(HttpApiEndpoint.post("fund")`/v1/agents/fund`.setPayload(AgentFundRequest).addSuccess(AgentRequestView))
    .add(HttpApiEndpoint.post("issue")`/v1/agents/issue`.setPayload(ApprovalId).addSuccess(AdminPermitResponse))
    .add(HttpApiEndpoint.post("revoke")`/v1/agents/revoke`.setPayload(Schema.Struct({ draftId: Schema.UUID, allocationId: UnsignedInteger })).addSuccess(SponsoredTransaction))
    .add(HttpApiEndpoint.post("identities")`/v1/agents/identities`.setPayload(Schema.Struct({ draftId: Schema.UUID })).addSuccess(Schema.Struct({
      namespace: Schema.String, registry: Schema.optional(WalletAddress), active: Schema.Boolean, identities: Schema.Array(AgentIdentity),
    })))
    .addError(HttpApiError.Unauthorized).addError(HttpApiError.Forbidden).addError(HttpApiError.NotFound)
    .addError(HttpApiError.ServiceUnavailable).addError(AgentActionError))
  .add(HttpApiGroup.make("sponsor")
    .add(HttpApiEndpoint.post("faucet")`/v1/sponsor/faucet`.addSuccess(SponsoredTransaction))
    .add(HttpApiEndpoint.post("relay")`/v1/sponsor/relay`.setPayload(SponsoredRequest).addSuccess(SponsoredTransaction))
    .addError(HttpApiError.Unauthorized).addError(HttpApiError.Forbidden)
    .addError(HttpApiError.BadRequest).addError(HttpApiError.ServiceUnavailable).addError(SponsorUnavailable))
  .add(HttpApiGroup.make("activity")
    .add(HttpApiEndpoint.post("list")`/v1/spaces/activity`.setPayload(SpaceActivityRequest).addSuccess(SpaceActivity))
    .addError(HttpApiError.NotFound).addError(HttpApiError.BadRequest).addError(HttpApiError.ServiceUnavailable))
  .add(HttpApiGroup.make("research")
    .add(HttpApiEndpoint.post("quote")`/v1/research/quotes`.setPayload(ResearchQuoteRequest).addSuccess(ResearchQuote))
    .add(HttpApiEndpoint.post("redeem")`/v1/research/redeem`.setPayload(ResearchRedeem).addSuccess(ResearchReport))
    .addError(HttpApiError.Unauthorized).addError(HttpApiError.Forbidden)
    .addError(HttpApiError.BadRequest).addError(HttpApiError.ServiceUnavailable))
  .add(HttpApiGroup.make("ens")
    .add(HttpApiEndpoint.post("resolve")`/v1/ens/resolve`
      .setPayload(ResolveEnsName).addSuccess(EnsNameState))
    .add(HttpApiEndpoint.post("recipient")`/v1/ens/recipient`
      .setPayload(ResolveEnsName).addSuccess(EnsRecipient))
    .add(HttpApiEndpoint.post("allocationNames")`/v1/ens/allocations`
      .setPayload(AllocationNameRequest).addSuccess(AllocationNameList))
    .addError(HttpApiError.BadRequest)
    .addError(HttpApiError.NotFound)
    .addError(HttpApiError.ServiceUnavailable))
  .add(
    HttpApiGroup.make("admin")
      .add(HttpApiEndpoint.post("createAllocation")`/v1/admin/allocations`
        .setPayload(AdminCreateAllocation).addSuccess(AdminPermitResponse))
      .add(HttpApiEndpoint.post("setMandate")`/v1/admin/mandates`
        .setPayload(AdminSetMandate).addSuccess(AdminPermitResponse))
      .add(HttpApiEndpoint.post("revokeMandate")`/v1/admin/mandates/revoke`
        .setPayload(AdminRevokeMandate).addSuccess(AdminPermitResponse))
      .add(HttpApiEndpoint.post("recoverAllocation")`/v1/admin/allocations/recover`
        .setPayload(AdminRecoverAllocation).addSuccess(AdminPermitResponse))
      .addError(HttpApiError.Unauthorized)
      .addError(HttpApiError.Forbidden)
      .addError(HttpApiError.BadRequest)
      .addError(HttpApiError.Conflict)
      .addError(HttpApiError.ServiceUnavailable),
  )
  .add(
    HttpApiGroup.make("status").add(
      HttpApiEndpoint.get("health")`/v1/health`.addSuccess(Health),
    ).add(HttpApiEndpoint.get("config")`/v1/config`.addSuccess(DeploymentConfig)),
  )
  .add(
    HttpApiGroup.make("catalog").add(
      HttpApiEndpoint.get("list")`/v1/catalog`.addSuccess(Catalog),
    ),
  )
  .add(
    HttpApiGroup.make("auth")
      .add(
        HttpApiEndpoint.post("challenge")`/v1/auth/challenge`
          .setPayload(ChallengeRequest)
          .addSuccess(ChallengeResponse),
      )
      .add(
        HttpApiEndpoint.post("verify")`/v1/auth/verify`
          .setPayload(VerifyRequest)
          .addSuccess(SessionResponse),
      )
      .add(
        HttpApiEndpoint.get("session")`/v1/auth/session`.addSuccess(SessionResponse),
      )
      .addError(HttpApiError.Unauthorized)
      .addError(HttpApiError.Forbidden)
      .addError(HttpApiError.BadRequest)
      .addError(HttpApiError.ServiceUnavailable),
  )
  .add(
    HttpApiGroup.make("spaces")
      .add(
        HttpApiEndpoint.get("list")`/v1/spaces`.addSuccess(SpaceDraftList),
      )
      .add(
        HttpApiEndpoint.get("received")`/v1/spaces/received`.addSuccess(ReceivedAllowanceList),
      )
      .add(
        HttpApiEndpoint.post("createDraft")`/v1/spaces/drafts`
          .setPayload(CreateSpaceDraft)
          .addSuccess(SpaceDraft),
      )
      .add(
        HttpApiEndpoint.post("activate")`/v1/spaces/activate`
          .setPayload(ActivateSpaceDraft)
          .addSuccess(SpaceDraft),
      )
      .add(
        HttpApiEndpoint.post("lookup")`/v1/spaces/lookup`
          .setPayload(LookupSpace)
          .addSuccess(SpaceDraft),
      )
      .add(
        HttpApiEndpoint.post("profile")`/v1/spaces/profile`
          .setPayload(LookupSpace)
          .addSuccess(SpaceProfile),
      )
      .addError(HttpApiError.Unauthorized)
      .addError(HttpApiError.Forbidden)
      .addError(HttpApiError.BadRequest)
      .addError(HttpApiError.NotFound)
      .addError(HttpApiError.ServiceUnavailable),
  )
  .add(
    HttpApiGroup.make("world")
      .add(HttpApiEndpoint.get("status")`/v1/world/status`.addSuccess(WorldStatus))
      .add(HttpApiEndpoint.post("unlink")`/v1/world/unlink`.addSuccess(WorldUnlinkResult))
      .add(HttpApiEndpoint.post("challenge")`/v1/world/challenge`
        .setPayload(WorldChallengeRequest).addSuccess(WorldChallenge))
      .add(HttpApiEndpoint.post("verify")`/v1/world/verify`
        .setPayload(WorldVerifyRequest).addSuccess(WorldVerification))
      .addError(HttpApiError.Unauthorized)
      .addError(HttpApiError.Forbidden)
      .addError(HttpApiError.ServiceUnavailable),
  )
  .add(
    HttpApiGroup.make("permits")
      .addError(DecisionRejected)
      .addError(ScreeningUnavailable)
    .addError(AgentApprovalRequired).addError(AgentActionError)
      .add(HttpApiEndpoint.post("prepareClaim")`/v1/permits/claims`
        .setPayload(PreparePermitRequest).addSuccess(PermitIntentResponse))
      .add(HttpApiEndpoint.post("signClaim")`/v1/permits/claims/sign`
        .setPayload(SignClaimRequest).addSuccess(PermitIntentResponse))
      .add(HttpApiEndpoint.post("authorizePayment")`/v1/permits/payments`
        .setPayload(PreparePermitRequest).addSuccess(PermitIntentResponse))
      .addError(HttpApiError.Unauthorized)
      .addError(HttpApiError.Forbidden)
      .addError(HttpApiError.BadRequest)
      .addError(HttpApiError.ServiceUnavailable),
  );
