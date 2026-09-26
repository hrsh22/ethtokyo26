import { AccordApi } from "@accord/api-contract";
import { hierarchicalEnsPermissionAdapterAbi, hashMandateTerms, PermitAction, signSpacePermit, spaceAccountAbi } from "@accord/chain";
import { HttpApiBuilder } from "@effect/platform";
import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { encodeFunctionData, getAddress, zeroAddress, zeroHash, type Hex } from "viem";
import { currentSession, requireBrowserOrigin } from "./auth";
import { envelope, makePermit, ownerSpace } from "./admin";
import { spaceAdapter, publicClient } from "./chain";
import { Database } from "./db";
import { agentPolicies, agentRequests, allocationNames, spaceDrafts, spaceNamespaces } from "./db/schema";
import { actionError, createRequest, livePolicy, liveSpace, readRequest, requestStatus, requestView, validateRequest, type Terms } from "./approval-state";
import { agentTry } from "./approvals";
import { confirmed, namespaceName, provisionAgent, registrarWallet, registryState } from "./namespaces";
import { ensRegistryAbi } from "./ens-v2";
import { serial } from "./serial";

export const AgentsLive=HttpApiBuilder.group(AccordApi,"agents",handlers=>handlers
  .handle("prepare",({payload})=>Effect.gen(function*(){
    const context=yield* ownerSpace(payload.draftId),db=yield* Database;
    return yield* agentTry(()=>serial(`prepare:${context.actor}:${payload.requestKey}`,async()=>{
      const {draft}=await liveSpace(db.client,payload.draftId);
      const allocation=await publicClient.readContract({address:context.space,abi:spaceAccountAbi,functionName:"allocations",args:[BigInt(payload.allocationId)]});
      const version=await publicClient.readContract({address:context.space,abi:spaceAccountAbi,functionName:"agentApprovalVersion"});
      if(version!==1n || allocation[0]!==zeroAddress || allocation[6] || allocation[1]===0n)throw actionError("Fund an agent budget in a new Space first.");
      const agent=getAddress(payload.agent),daily=BigInt(payload.dailyCap),per=BigInt(payload.maxPerPayment),expiry=BigInt(payload.expiry),threshold=BigInt(payload.approvalThreshold);
      if(agent===zeroAddress || daily<=0n || per<=0n || per>daily || threshold>per || daily>=1n<<256n
        || expiry<=context.block.timestamp+60n || expiry>context.block.timestamp+180n*86400n)throw actionError("Check the limits and choose an expiry within 180 days.");
      const [savedNamespace]=await db.client.select().from(spaceNamespaces).where(eq(spaceNamespaces.spaceAddress,context.space));
      const name=`${payload.label}.${savedNamespace?.name??namespaceName(draft).name}`;
      const terms:Terms={agent,agentName:name,label:payload.label,amount:allocation[1].toString(),remaining:allocation[1].toString(),
        dailyCap:daily.toString(),maxPerPayment:per.toString(),approvalThreshold:threshold.toString(),expiry:expiry.toString()};
      let restrictive=false;
      try {
        const {policy}=await livePolicy(db.client,context.space,payload.allocationId);
        restrictive=policy.agent.toLowerCase()===agent.toLowerCase() && policy.name===name && daily<=BigInt(policy.dailyCap)
          && per<=BigInt(policy.maxPerPayment) && expiry<=BigInt(policy.expiry) && threshold>=BigInt(policy.approvalThreshold);
      } catch { /* A new or invalid identity always needs fresh human approval. */ }
      const row=await createRequest(db.client,{kind:"grant",owner:context.actor,actor:context.actor,draftId:draft.id,spaceAddress:context.space,
        allocationId:payload.allocationId,requestKey:payload.requestKey,policyVersion:context.policyVersion.toString(),terms,approved:restrictive});
      return requestView(db.client,row);
    }));
  }))
  .handle("fund",({payload})=>Effect.gen(function*(){
    const context=yield* ownerSpace(payload.draftId),db=yield* Database;
    return yield* agentTry(()=>serial(`prepare:${context.actor}:${payload.requestKey}`,async()=>{
      const {policy}=await livePolicy(db.client,context.space,payload.allocationId);
      if(BigInt(payload.amount)<=0n || BigInt(payload.amount)>=1n<<256n)throw actionError("Enter a positive amount.");
      const row=await createRequest(db.client,{kind:"fund",owner:context.actor,actor:context.actor,draftId:payload.draftId,spaceAddress:context.space,
        allocationId:payload.allocationId,requestKey:payload.requestKey,policyVersion:context.policyVersion.toString(),
        terms:{agent:policy.agent,agentName:policy.name,amount:payload.amount,policyId:policy.requestId}});
      return requestView(db.client,row);
    }));
  }))
  .handle("issue",({payload})=>Effect.gen(function*(){
    yield* requireBrowserOrigin();const session=yield* currentSession(),db=yield* Database;
    const row=yield* agentTry(()=>readRequest(db.client,payload.id));
    const context=yield* ownerSpace(row.draftId);
    return yield* agentTry(()=>serial(`approval:${row.id}`,async()=>{
      const current=await readRequest(db.client,row.id);
      if(current.owner!==session.address || !["grant","fund"].includes(current.kind))throw actionError("Only the owner can issue this delegation.");
      if(current.envelope) {
        const saved=JSON.parse(current.envelope) as ReturnType<typeof envelope>;
        const used=await publicClient.readContract({address:context.space,abi:spaceAccountAbi,functionName:"consumedRequests",args:[saved.permit.requestId as Hex]});
        if(!used) {
          await validateRequest(db.client,current);
          if(BigInt(saved.permit.expiry)<=BigInt(Math.floor(Date.now()/1000)))throw actionError("The transaction permission expired. Start a new approval.");
        }
        return saved;
      }
      if(requestStatus(current)!=="approved")throw actionError("Approve this request after World verification first.");
      const {draft,terms}=await validateRequest(db.client,current);
      const allocationId=BigInt(current.allocationId);
      let output:ReturnType<typeof envelope>;
      if(current.kind==="fund") {
        const amount=BigInt(terms.amount);
        const permit=await makePermit(context,current.requestKey,PermitAction.FundAgentAllocation,allocationId,context.actor,amount,zeroHash);
        permit.expiry=BigInt(Math.min(Number(permit.expiry),Math.floor(current.expiresAt.getTime()/1000)));
        const signature=await signSpacePermit(context.signer,context.space,permit);
        output=envelope(context,permit,signature,"fundAgentAllocation",encodeFunctionData({abi:spaceAccountAbi,functionName:"fundAgentAllocation",args:[allocationId,amount,permit,signature]}),amount);
      } else {
        const identity=await provisionAgent(db.client,draft,current.id,{label:terms.label!,agent:terms.agent,expiry:terms.expiry!,deadline:Math.floor(current.expiresAt.getTime()/1000)});
        // Provisioning can take several blocks. Recheck policy and request lifetime.
        await validateRequest(db.client,current);
        if(current.expiresAt<=new Date())throw actionError("Approval expired while creating the ENS identity. Start a new approval.");
        const allocation=await publicClient.readContract({address:context.space,abi:spaceAccountAbi,functionName:"allocations",args:[allocationId]});
        if(allocation[1]>BigInt(terms.remaining!))throw actionError("Funding increased after approval. Review the new terms.");
        const config={agent:getAddress(terms.agent),registry:identity.registry,nameId:identity.nameId,expectedResource:identity.resource,
          dailyCap:BigInt(terms.dailyCap!),maxPerPayment:BigInt(terms.maxPerPayment!),expiry:BigInt(terms.expiry!)};
        const permit=await makePermit({...context,block:await publicClient.getBlock()},current.requestKey,PermitAction.SetMandate,allocationId,config.agent,0n,hashMandateTerms(config));
        permit.expiry=BigInt(Math.min(Number(permit.expiry),Number(config.expiry),Math.floor(current.expiresAt.getTime()/1000)));
        const signature=await signSpacePermit(context.signer,context.space,permit);
        if (!identity.preCalls) await publicClient.simulateContract({address:context.space,abi:spaceAccountAbi,functionName:"setMandate",args:[allocationId,config,permit,signature],account:context.actor});
        output=envelope(context,permit,signature,"setMandate",encodeFunctionData({abi:spaceAccountAbi,functionName:"setMandate",args:[allocationId,config,permit,signature]}),0n);
        output.preCalls = identity.preCalls;
        await db.client.insert(agentPolicies).values({requestId:current.id,spaceAddress:context.space,allocationId:current.allocationId,
          name:identity.name,agent:config.agent,registry:identity.registry,nameId:identity.nameId.toString(),resource:identity.resource.toString(),
          dailyCap:terms.dailyCap!,maxPerPayment:terms.maxPerPayment!,approvalThreshold:terms.approvalThreshold!,expiry:terms.expiry!,permitRequestId:permit.requestId,createdAt:new Date()}).onConflictDoNothing();
        await db.client.insert(allocationNames).values({requestId:permit.requestId,spaceAddress:context.space,allocationId:current.allocationId,
          beneficiary:config.agent,name:identity.name,resolvedBlock:context.block.number.toString()}).onConflictDoNothing();
      }
      await db.client.update(agentRequests).set({status:"issued",envelope:JSON.stringify(output)}).where(eq(agentRequests.id,current.id));
      return output;
    }));
  }))
  .handle("revoke",({payload})=>Effect.gen(function*(){
    const context=yield* ownerSpace(payload.draftId),db=yield* Database;
    return yield* agentTry(()=>serial("ens-registrar",async()=>{
      const rows=await db.client.select().from(agentPolicies).where(and(eq(agentPolicies.spaceAddress,context.space),eq(agentPolicies.allocationId,payload.allocationId))).orderBy(desc(agentPolicies.createdAt));
      const mandate=await publicClient.readContract({address:context.space,abi:spaceAccountAbi,functionName:"mandates",args:[BigInt(payload.allocationId)]});
      const policy=rows.find(p=>p.registry.toLowerCase()===mandate[1].toLowerCase() && BigInt(p.nameId)===mandate[2] && BigInt(p.resource)===mandate[3]);if(!policy)throw actionError("No managed agent identity was found.");
      const registry=getAddress(policy.registry),label=policy.name.split(".")[0]!;
      const state=await registryState(registry,label);
      if(state.resource!==BigInt(policy.resource) || state.status!==2)throw actionError("This ENS identity is already revoked or has changed.");
      const hash=await registrarWallet().writeContract({address:registry,abi:ensRegistryAbi,functionName:"unregister",args:[BigInt(policy.nameId)]});
      await confirmed(hash);
      await db.client.update(agentPolicies).set({revokedAt:new Date()}).where(and(eq(agentPolicies.registry,registry),eq(agentPolicies.nameId,policy.nameId),eq(agentPolicies.resource,policy.resource)));
      return {transactionHash:hash};
    }));
  }))
  .handle("identities",({payload})=>Effect.gen(function*(){
    const db=yield* Database;
    return yield* agentTry(async()=>{
      const [draft]=await db.client.select().from(spaceDrafts).where(eq(spaceDrafts.id,payload.draftId));
      if(!draft?.spaceAddress)throw actionError("Space not found.");
      const [namespace]=await db.client.select().from(spaceNamespaces).where(eq(spaceNamespaces.spaceAddress,getAddress(draft.spaceAddress)));
      const policies=await db.client.select().from(agentPolicies).where(eq(agentPolicies.spaceAddress,getAddress(draft.spaceAddress))).orderBy(desc(agentPolicies.createdAt));
      const ids=[...new Set(policies.map(p=>p.allocationId))];
      const identities=await Promise.all(ids.map(async allocationId=>{
        const candidates=policies.filter(p=>p.allocationId===allocationId);
        const mandate=await publicClient.readContract({address:getAddress(draft.spaceAddress!),abi:spaceAccountAbi,functionName:"mandates",args:[BigInt(allocationId)]});
        const p=candidates.find(p=>p.registry.toLowerCase()===mandate[1].toLowerCase() && BigInt(p.nameId)===mandate[2] && BigInt(p.resource)===mandate[3]
          && BigInt(p.dailyCap)===mandate[4] && BigInt(p.maxPerPayment)===mandate[5] && BigInt(p.expiry)===mandate[8])??candidates[0]!;
        const confirmed=await publicClient.readContract({address:getAddress(p.spaceAddress),abi:spaceAccountAbi,functionName:"consumedRequests",args:[p.permitRequestId as Hex]});
        let active=false;try{const current=await livePolicy(db.client,p.spaceAddress,p.allocationId);active=current.policy.requestId===p.requestId;}catch{/* inactive */}
        return {name:p.name,agent:getAddress(p.agent),allocationId:p.allocationId,registry:getAddress(p.registry),nameId:p.nameId,resource:p.resource,
          approvalThreshold:p.approvalThreshold,expiry:p.expiry,active,confirmed,revoked:!!p.revokedAt};
      }));
      const active=namespace?await publicClient.readContract({address:await spaceAdapter(getAddress(draft.spaceAddress)),abi:hierarchicalEnsPermissionAdapterAbi,functionName:"namespaceActive",args:[getAddress(namespace.registry)]}):false;
      return {namespace:namespace?.name??namespaceName(draft).name,...(namespace?{registry:getAddress(namespace.registry)}:{}),active,identities};
    });
  })));
