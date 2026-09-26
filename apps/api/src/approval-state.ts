import { AgentActionError } from "@accord/api-contract";
import { ensPermissionAdapterAbi, spaceAccountAbi } from "@accord/chain";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getAddress, zeroAddress } from "viem";
import { isConfiguredAddress, spaceAdapter, permitSigner, publicClient } from "./chain";
import type { DatabaseClient } from "./db";
import { agentPolicies, agentRequests, ownerIdentities, permitIntents, spaceDrafts } from "./db/schema";

export type RequestRow=typeof agentRequests.$inferSelect;
export type PolicyRow=typeof agentPolicies.$inferSelect;
export type Terms={agent:string;agentName:string;amount:string;recipient?:string;label?:string;dailyCap?:string;
  maxPerPayment?:string;approvalThreshold?:string;expiry?:string;policyId?:string;remaining?:string;
  purchaseTitle?:string;purchaseDescription?:string};
export const actionError=(message:string)=>new AgentActionError({message});
export function requestStatus(row:RequestRow) {
  return ["pending","verified","approved"].includes(row.status) && row.expiresAt<=new Date() ? "expired" : row.status;
}
export async function requestView(db:DatabaseClient,row:RequestRow) {
  const [draft]=await db.select().from(spaceDrafts).where(eq(spaceDrafts.id,row.draftId));
  const t=JSON.parse(row.payload) as Terms;
  let status=requestStatus(row);
  if(status==="issued") {
    const saved=row.envelope?JSON.parse(row.envelope).permit as {requestId:`0x${string}`;expiry:string}:undefined;
    const [intent]=row.permitIntentId?await db.select().from(permitIntents).where(eq(permitIntents.id,row.permitIntentId)):[];
    const requestId=saved?.requestId??intent?.requestId;
    if(requestId){
      const consumed=await publicClient.readContract({address:getAddress(row.spaceAddress),abi:spaceAccountAbi,functionName:"consumedRequests",args:[requestId as `0x${string}`]});
      if(consumed)status="executed";
      else if((saved?Number(saved.expiry)*1000:intent!.expiry.getTime())<=Date.now())status="expired";
    }
  }
  if(["pending","verified","approved","issued"].includes(status)) {
    try { await validateRequest(db,row); }
    catch(error) { if(error instanceof AgentActionError)status="invalidated";else throw error; }
  }
  return {id:row.id,kind:row.kind,status,draftId:row.draftId,spaceAddress:getAddress(row.spaceAddress),
    spaceName:draft?.name??"Space",allocationId:row.allocationId,owner:getAddress(row.owner),agent:getAddress(t.agent),
    agentName:t.agentName,amount:t.amount,...(t.recipient?{recipient:getAddress(t.recipient)}:{}),
    ...(t.dailyCap?{dailyCap:t.dailyCap}:{}),...(t.maxPerPayment?{maxPerPayment:t.maxPerPayment}:{}),
    ...(t.approvalThreshold!==undefined?{approvalThreshold:t.approvalThreshold}:{}),...(t.expiry?{expiry:t.expiry}:{}),
    ...(t.purchaseTitle?{purchaseTitle:t.purchaseTitle}:{}),...(t.purchaseDescription?{purchaseDescription:t.purchaseDescription}:{}),
    expiresAt:row.expiresAt.toISOString(),createdAt:row.createdAt.toISOString(),verified:!!row.verifiedAt};
}
export async function readRequest(db:DatabaseClient,id:string) {
  const [row]=await db.select().from(agentRequests).where(eq(agentRequests.id,id));
  if (!row) throw actionError("This approval request was not found.");
  return row;
}
export async function liveSpace(db:DatabaseClient,draftId:string) {
  const [draft]=await db.select().from(spaceDrafts).where(eq(spaceDrafts.id,draftId));
  if (!draft?.activatedAt || !draft.spaceAddress || !draft.tokenAddress) throw actionError("This Space is unavailable.");
  const address=getAddress(draft.spaceAddress), at={address,abi:spaceAccountAbi} as const;
  const [owner,authorizer,token,adapter,version]=await Promise.all([
    publicClient.readContract({...at,functionName:"owner"}),publicClient.readContract({...at,functionName:"authorizer"}),
    publicClient.readContract({...at,functionName:"token"}),publicClient.readContract({...at,functionName:"ensAdapter"}),
    publicClient.readContract({...at,functionName:"policyVersion"}),
  ]);
  if (owner.toLowerCase()!==draft.owner || authorizer.toLowerCase()!==permitSigner().address.toLowerCase()
    || token.toLowerCase()!==draft.tokenAddress.toLowerCase() || !isConfiguredAddress("ENS_ADAPTER_ADDRESS",adapter)) throw actionError("This Space needs the current agent contract. Create a new Space.");
  return {draft,address,owner,version};
}
export async function livePolicy(db:DatabaseClient,space:string,allocationId:string) {
  const address=getAddress(space), id=BigInt(allocationId);
  const [allocation,mandate]=await Promise.all([
    publicClient.readContract({address,abi:spaceAccountAbi,functionName:"allocations",args:[id]}),
    publicClient.readContract({address,abi:spaceAccountAbi,functionName:"mandates",args:[id]}),
  ]);
  if (allocation[0]!==zeroAddress || allocation[6] || !mandate[9] || mandate[8]<=BigInt(Math.floor(Date.now()/1000))) throw actionError("This agent mandate is inactive or expired.");
  const rows=await db.select().from(agentPolicies).where(and(eq(agentPolicies.spaceAddress,address),eq(agentPolicies.allocationId,allocationId))).orderBy(desc(agentPolicies.createdAt));
  for (const p of rows) {
    if (p.revokedAt || p.agent.toLowerCase()!==mandate[0].toLowerCase() || p.registry.toLowerCase()!==mandate[1].toLowerCase()
      || BigInt(p.nameId)!==mandate[2] || BigInt(p.resource)!==mandate[3] || BigInt(p.dailyCap)!==mandate[4]
      || BigInt(p.maxPerPayment)!==mandate[5] || BigInt(p.expiry)!==mandate[8]) continue;
    const [consumed,authorized]=await Promise.all([
      publicClient.readContract({address,abi:spaceAccountAbi,functionName:"consumedRequests",args:[p.permitRequestId as `0x${string}`]}),
      publicClient.readContract({address:await spaceAdapter(address),abi:ensPermissionAdapterAbi,functionName:"isAuthorized",args:[mandate[1],mandate[2],mandate[3],mandate[0]]}),
    ]);
    if(consumed && authorized)return {policy:p,allocation,mandate};
  }
  throw actionError("The agent's ENS identity is revoked, expired, or needs owner authorization.");
}
export async function createRequest(db:DatabaseClient,input:{kind:string;owner:string;actor:string;draftId:string;spaceAddress:string;allocationId:string;requestKey:string;policyVersion:string;terms:Terms;expiresAt?:Date;approved?:boolean}) {
  const payload=JSON.stringify(input.terms);
  const [existing]=await db.select().from(agentRequests).where(and(eq(agentRequests.actor,input.actor.toLowerCase()),eq(agentRequests.requestKey,input.requestKey)));
  if(existing){
    if(existing.kind!==input.kind || existing.draftId!==input.draftId || existing.allocationId!==input.allocationId || existing.payload!==payload) throw actionError("This request key already belongs to different terms.");
    return existing;
  }
  const [identity]=await db.select().from(ownerIdentities).where(eq(ownerIdentities.address,input.owner.toLowerCase()));
  const [row]=await db.insert(agentRequests).values({id:randomUUID(),kind:input.kind,owner:input.owner.toLowerCase(),actor:input.actor.toLowerCase(),
    draftId:input.draftId,spaceAddress:getAddress(input.spaceAddress),allocationId:input.allocationId,requestKey:input.requestKey,
    payload,policyVersion:input.policyVersion,identityId:identity?.id,expiresAt:input.expiresAt??new Date(Date.now()+8*60_000),
    status:input.approved?"approved":"pending",createdAt:new Date()}).returning();
  return row!;
}
export async function validateRequest(db:DatabaseClient,row:RequestRow) {
  if(!["pending","verified","approved","issued"].includes(requestStatus(row)))throw actionError(`This request is ${requestStatus(row)}. Start a new request.`);
  const {draft,version}=await liveSpace(db,row.draftId);
  if(draft.owner!==row.owner || version.toString()!==row.policyVersion)throw actionError("The Space policy changed. Start a new request.");
  const [identity]=await db.select().from(ownerIdentities).where(eq(ownerIdentities.address,row.owner));
  if(row.identityId && identity?.id!==row.identityId)throw actionError("The owner's identity changed. Start a new request.");
  const terms=JSON.parse(row.payload) as Terms;
  if(row.kind!=="grant") {
    const {policy}=await livePolicy(db,row.spaceAddress,row.allocationId);
    if(policy.requestId!==terms.policyId)throw actionError("The agent's authority changed. Start a new request.");
  }
  return {draft,terms};
}
