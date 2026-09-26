import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

const Check = Schema.Struct({
  label: Schema.String,
  source: Schema.Literal("Accord record", "Sepolia", "Historical simulation"),
  status: Schema.Literal("passed", "failed", "unavailable"),
  detail: Schema.String,
});
const Report = Schema.Struct({
  collectedAt: Schema.String,
  repositories: Schema.Array(Schema.Struct({
    name: Schema.String, url: Schema.String, description: Schema.NullOr(Schema.String),
    license: Schema.String, commits: Schema.NullOr(Schema.Number), truncated: Schema.Boolean,
    coverage: Schema.String, sources: Schema.Array(Schema.String),
  })),
});
export const DemoEvidence = Schema.Struct({
  checkedAt: Schema.String, blockNumber: Schema.NullOr(Schema.String), chainId: Schema.Literal(11155111),
  spaceAddress: Schema.String, spaceName: Schema.String, agentName: Schema.String, allocationId: Schema.String,
  identity: Schema.Struct({ status: Schema.Literal("active", "inactive", "unavailable"), remaining: Schema.NullOr(Schema.String) }),
  cases: Schema.Array(Schema.Struct({
    id: Schema.Literal("approved", "denied", "revoked"), quoteId: Schema.String, amount: Schema.String,
    recipient: Schema.NullOr(Schema.String), createdAt: Schema.NullOr(Schema.String),
    repositories: Schema.Array(Schema.String), criteria: Schema.Array(Schema.String),
    transactionHash: Schema.NullOr(Schema.String), checks: Schema.Array(Check), report: Schema.NullOr(Report),
  })),
});
export type PublicDemoEvidence = typeof DemoEvidence.Type;
export const DemoGroup = HttpApiGroup.make("demo")
  .add(HttpApiEndpoint.get("evidence")`/v1/demo/evidence`.addSuccess(DemoEvidence));
