import { AccordApi } from "@accord/api-contract";
import { FetchHttpClient, HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect } from "effect";
import type { PaymentDecision, AgentRequestView, AgentGrantRequest, AgentFundRequest } from "@accord/api-contract";

export type ApprovalRequest = typeof AgentRequestView.Type;
export function paymentApprovalRequired(error: unknown): ApprovalRequest | undefined {
  if (error && typeof error === "object" && "_tag" in error && error._tag === "AgentApprovalRequired" && "request" in error)
    return error.request as ApprovalRequest;
}

// Preserve typed HTTP errors instead of wrapping their useful fields in FiberFailure.
async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag === "Left") throw result.left;
  return result.right;
}

export type Decision = typeof PaymentDecision.Type;
export function paymentDecision(error: unknown): Decision | undefined {
  if (error && typeof error === "object" && "_tag" in error &&
    (error._tag === "DecisionRejected" || error._tag === "ScreeningUnavailable") && "decision" in error) {
    return error.decision as Decision;
  }
}

export type ActivateSpaceRequest = {
  draftId: string;
  deploymentTx: `0x${string}`;
};

export type PermitRequest = {
  draftId: string;
  allocationId: string;
  amount: string;
  requestKey: string;
  recipient?: `0x${string}`;
};

export type CreateAllocationRequest = {
  draftId: string;
  requestKey: string;
  beneficiary: `0x${string}`;
  beneficiaryEnsName?: string;
  amount: string;
  periodCap: string;
  period: 0 | 1 | 2 | 3;
  schedule?: { intervalSeconds: number; durationSeconds: number };
};

export type SetMandateRequest = {
  draftId: string;
  requestKey: string;
  allocationId: string;
  agent: `0x${string}`;
  registry: `0x${string}`;
  nameId: string;
  expectedResource: string;
  dailyCap: string;
  maxPerPayment: string;
  expiry: string;
  agentEnsName?: string;
};

export type RevokeMandateRequest = {
  draftId: string;
  requestKey: string;
  allocationId: string;
};
export type RecoverAllocationRequest = RevokeMandateRequest;

export type WorldChallengeMode = "enroll" | "reverify" | "claim";

export async function createAccordClient(baseUrl: string, options?: { bearerToken?: string }) {
  const client = await Effect.runPromise(
    HttpApiClient.make(AccordApi, {
      baseUrl,
      ...(options?.bearerToken ? {
        transformClient: HttpClient.mapRequest(
          HttpClientRequest.setHeader("authorization", `Bearer ${options.bearerToken}`),
        ),
      } : {}),
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
    ),
  );

  return {
    demoEvidence: () => run(client.demo.evidence()),
    approvals: () => run(client.approvals.list()),
    resolveAgent: (name: string) => run(client.toolkit.resolve({ payload: { name } })),
    pairAgent: (name?: string) => run(client.toolkit.pair({ payload: { ...(name ? { name } : {}) } })),
    reviewAgentPairing: (id: string, reviewToken: string) => run(client.toolkit.review({ payload: { id, reviewToken } })),
    acceptAgentPairing: (payload: { id: string; reviewToken: string; draftId: string; allocationId: string }) => run(client.toolkit.accept({ payload })),
    pollAgentPairing: (id: string, pollToken: string) => run(client.toolkit.poll({ payload: { id, pollToken } })),
    agentConnections: (draftId: string, allocationId: string) => run(client.toolkit.connections({ payload: { draftId, allocationId } })),
    disconnectAgent: (id: string) => run(client.toolkit.disconnect({ payload: { id } })),
    approval: (id: string) => run(client.approvals.get({ payload: { id } })),
    authenticateApproval: (id: string) => run(client.approvals.authenticate({ payload: { id } })),
    decideApproval: (id: string, decision: "approve" | "deny" | "cancel") => run(client.approvals.decide({ payload: { id, decision } })),
    prepareAgent: (payload: typeof AgentGrantRequest.Type) => run(client.agents.prepare({ payload })),
    fundAgent: (payload: typeof AgentFundRequest.Type) => run(client.agents.fund({ payload })),
    issueAgentRequest: (id: string) => run(client.agents.issue({ payload: { id } })),
    agentIdentities: (draftId: string) => run(client.agents.identities({ payload: { draftId } })),
    revokeAgentIdentity: (draftId: string, allocationId: string) => run(client.agents.revoke({ payload: { draftId, allocationId } })),
    health: () => Effect.runPromise(client.status.health()),
    config: () => Effect.runPromise(client.status.config()),
    resolveEnsName: (name: string) => Effect.runPromise(client.ens.resolve({ payload: { name } })),
    resolveEnsRecipient: (name: string) => run(client.ens.recipient({ payload: { name } })),
    allocationNames: (spaceAddress: string, allocationIds: string[]) => run(client.ens.allocationNames({ payload: { spaceAddress, allocationIds } })),
    listTemplates: () => Effect.runPromise(client.catalog.list()),
    createChallenge: (address: `0x${string}`) =>
      Effect.runPromise(client.auth.challenge({ payload: { address } })),
    verifyChallenge: (payload: {
      id: string;
      address: `0x${string}`;
      signature: `0x${string}`;
      client: "browser" | "agent";
      connectionId?: string;
    }) => Effect.runPromise(client.auth.verify({ payload })),
    session: () => run(client.auth.session()),
    listSpaces: () => run(client.spaces.list()),
    listReceivedAllowances: () => run(client.spaces.received()),
    claimTestUSDC: () => run(client.sponsor.faucet()),
    relay: (payload: { from: `0x${string}`; to: `0x${string}`; value: string; gas: string; nonce: string; deadline: string;
      data: `0x${string}`; signature: `0x${string}` }) => run(client.sponsor.relay({ payload })),
    createDraft: (payload: {
      name: string;
      templateId: "recurring-support" | "research-budget";
    }) => run(client.spaces.createDraft({ payload })),
    activateSpace: (payload: ActivateSpaceRequest) =>
      run(client.spaces.activate({ payload })),
    spaceProfile: (spaceAddress: `0x${string}`) => run(client.spaces.profile({ payload: { spaceAddress } })),
    lookupSpace: (spaceAddress: `0x${string}`) =>
      Effect.runPromise(client.spaces.lookup({ payload: { spaceAddress } })),
    spaceActivity: (payload: { spaceAddress: string; beforeBlock?: string }) => run(client.activity.list({ payload })),
    createAllocation: (payload: CreateAllocationRequest) =>
      run(client.admin.createAllocation({ payload })),
    setMandate: (payload: SetMandateRequest) =>
      Effect.runPromise(client.admin.setMandate({ payload })),
    revokeMandate: (payload: RevokeMandateRequest) =>
      Effect.runPromise(client.admin.revokeMandate({ payload })),
    recoverAllocation: (payload: RecoverAllocationRequest) =>
      Effect.runPromise(client.admin.recoverAllocation({ payload })),
    worldStatus: () => Effect.runPromise(client.world.status()),
    worldUnlink: () => run(client.world.unlink()),
    worldChallenge: (mode: WorldChallengeMode, intentId?: string) =>
      Effect.runPromise(client.world.challenge({
        payload: { mode, ...(intentId ? { intentId } : {}) },
      })),
    worldVerify: (id: string, result: unknown) =>
      Effect.runPromise(client.world.verify({ payload: { id, result } })),
    prepareClaim: (payload: PermitRequest) =>
      run(client.permits.prepareClaim({ payload })),
    signClaim: (intentId: string) =>
      run(client.permits.signClaim({ payload: { intentId } })),
    authorizePayment: (payload: PermitRequest) =>
      run(client.permits.authorizePayment({ payload })),
    researchQuote: (payload: { draftId: string; allocationId: string }) => run(client.research.quote({ payload })),
    researchStatus: (quoteId: string) => run(client.research.status({ payload: { quoteId } })),
    researchRedeem: (payload: { quoteId: string; transactionHash: string }) => run(client.research.redeem({ payload })),
  };
}

export type AccordClient = Awaited<ReturnType<typeof createAccordClient>>;
