import { AccordApi } from "@accord/api-contract";
import { FetchHttpClient, HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect } from "effect";
import type { PaymentDecision } from "@accord/api-contract";

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
    }) => Effect.runPromise(client.auth.verify({ payload })),
    session: () => run(client.auth.session()),
    listSpaces: () => run(client.spaces.list()),
    createDraft: (payload: {
      name: string;
      templateId: "recurring-support" | "research-budget";
    }) => run(client.spaces.createDraft({ payload })),
    activateSpace: (payload: ActivateSpaceRequest) =>
      run(client.spaces.activate({ payload })),
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
    researchRedeem: (payload: { quoteId: string; transactionHash: string }) => run(client.research.redeem({ payload })),
  };
}

export type AccordClient = Awaited<ReturnType<typeof createAccordClient>>;
