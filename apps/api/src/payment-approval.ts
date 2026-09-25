import { AgentApprovalRequired } from "@accord/api-contract";
import { and, eq } from "drizzle-orm";
import { getAddress } from "viem";
import type { DatabaseClient } from "./db";
import { agentRequests, researchQuotes } from "./db/schema";
import { actionError, createRequest, livePolicy, liveSpace, readRequest, requestStatus, requestView, validateRequest } from "./approval-state";

export async function paymentApproval(db:DatabaseClient,payload:{draftId:string;allocationId:string;amount:string;requestKey:string;recipient?:string},actor:string) {
  const {draft,address,owner,version}=await liveSpace(db,payload.draftId);
  const {policy,allocation,mandate}=await livePolicy(db,address,payload.allocationId);
  const amount=BigInt(payload.amount);
  if(policy.agent.toLowerCase()!==actor.toLowerCase() || amount<=0n || amount>allocation[1] || amount>mandate[5])throw actionError("This payment exceeds the agent's authority or available budget.");
  const today=BigInt(Math.floor(Date.now()/1000/86400));
  if((mandate[7]===today?mandate[6]:0n)+amount>mandate[4])throw actionError("This payment exceeds the daily budget.");
  const [existing]=await db.select().from(agentRequests).where(and(eq(agentRequests.actor,actor.toLowerCase()),eq(agentRequests.requestKey,payload.requestKey)));
  if(amount<=BigInt(policy.approvalThreshold) && !existing)return null;
  let expiresAt=new Date(Math.min(Date.now()+8*60_000,Number(mandate[8])*1000));
  const [quote]=await db.select().from(researchQuotes).where(eq(researchQuotes.id,payload.requestKey));
  if(quote) {
    if(quote.actor!==actor.toLowerCase() || quote.draftId!==draft.id || quote.allocationId!==payload.allocationId
      || quote.amount!==payload.amount || quote.recipient.toLowerCase()!==payload.recipient!.toLowerCase() || quote.expiresAt<=new Date())throw actionError("The purchase quote changed or expired. Request a new quote.");
    expiresAt=new Date(Math.min(expiresAt.getTime(),quote.expiresAt.getTime()));
  }
  const row=await createRequest(db,{kind:"payment",owner,actor,draftId:draft.id,spaceAddress:address,allocationId:payload.allocationId,
    requestKey:payload.requestKey,policyVersion:version.toString(),expiresAt,
    terms:{agent:getAddress(actor),agentName:policy.name,amount:payload.amount,recipient:getAddress(payload.recipient!),policyId:policy.requestId}});
  await validateRequest(db,row);
  if(!["approved","issued"].includes(requestStatus(row)))throw new AgentApprovalRequired({request:await requestView(db,row)});
  return row;
}

export async function assertPaymentApproval(db:DatabaseClient,id:string,intentId?:string) {
  const row=await readRequest(db,id);
  await validateRequest(db,row);
  if(!["approved","issued"].includes(requestStatus(row)) || (row.permitIntentId && row.permitIntentId!==intentId))throw actionError("This payment no longer has a matching owner approval.");
  return row;
}
