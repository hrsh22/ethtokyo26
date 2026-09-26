import { AccordApi, AgentActionError } from "@accord/api-contract";
import { HttpApiBuilder, HttpServerResponse } from "@effect/platform";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { assertAgentScope, currentSession, requireBrowserOrigin } from "./auth";
import { Database } from "./db";
import { agentRequests, ownerIdentities, sessions, worldAuthorizations } from "./db/schema";
import { actionError, readRequest, requestStatus, requestView, validateRequest } from "./approval-state";
import { exchangeWorldCode, worldAgentsConfigured, worldAuthorizationUrl } from "./world-agents";
import { serial } from "./serial";

export const agentTry=<A>(work:()=>Promise<A>)=>Effect.tryPromise({try:work,catch:(error)=>error instanceof AgentActionError ? error : actionError("Could not complete this action. Please try again.")});
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");

export const ApprovalsLive=HttpApiBuilder.group(AccordApi,"approvals",handlers=>handlers
  .handle("list",()=>Effect.gen(function*(){
    const session=yield* currentSession(),db=yield* Database;
    return yield* agentTry(async()=>{
      const rows=await db.client.select().from(agentRequests).where(eq(agentRequests.owner,session.address)).orderBy(desc(agentRequests.createdAt)).limit(40);
      const [identity]=await db.client.select().from(ownerIdentities).where(eq(ownerIdentities.address,session.address));
      return {configured:worldAgentsConfigured(),identified:!!identity,requests:await Promise.all(rows.map(row=>requestView(db.client,row)))};
    });
  }))
  .handle("get",({payload})=>Effect.gen(function*(){
    const session=yield* currentSession(),db=yield* Database;
    const scopedRow=yield* agentTry(()=>readRequest(db.client,payload.id));
    yield* assertAgentScope(session,scopedRow);
    return yield* agentTry(async()=>{
      const row=await readRequest(db.client,payload.id);
      if(row.owner!==session.address && row.actor!==session.address)throw actionError("This request belongs to another account.");
      return requestView(db.client,row);
    });
  }))
  .handle("authenticate",({payload})=>Effect.gen(function*(){
    yield* requireBrowserOrigin();const session=yield* currentSession(),db=yield* Database;
    return yield* agentTry(()=>serial(`approval:${payload.id}`,async()=>{
      const row=await readRequest(db.client,payload.id);
      if(row.owner!==session.address || !["pending","verified"].includes(requestStatus(row)))throw actionError("This request cannot start verification.");
      await validateRequest(db.client,row);
      const state=randomBytes(32).toString("base64url"),nonce=randomBytes(32).toString("base64url"),verifier=randomBytes(32).toString("base64url");
      const challenge=createHash("sha256").update(verifier).digest("base64url");
      const url=worldAuthorizationUrl(state,nonce,challenge);
      await db.client.transaction(async tx=>{
        await tx.delete(worldAuthorizations).where(eq(worldAuthorizations.requestId,row.id));
        await tx.insert(worldAuthorizations).values({stateHash:hash(state),requestId:row.id,owner:row.owner,sessionHash:session.tokenHash,
          nonce,verifier,expiresAt:row.expiresAt,createdAt:new Date()});
        await tx.update(agentRequests).set({status:"pending",verifiedAt:null,verificationSession:null}).where(eq(agentRequests.id,row.id));
      });
      return {url};
    }));
  }))
  .handleRaw("worldCallback",({urlParams})=>Effect.gen(function*(){
    const db=yield* Database;
    // Every failure ends on a fixed frontend route; no provider query or token is echoed.
    const result=yield* Effect.promise(async()=>{
      let requestId:string|undefined;
      try {
        if(!urlParams.state || urlParams.state.length>128)throw new Error("Missing OAuth state");
        const [attempt]=await db.client.update(worldAuthorizations).set({consumedAt:new Date()}).where(and(
          eq(worldAuthorizations.stateHash,hash(urlParams.state)),isNull(worldAuthorizations.consumedAt),gt(worldAuthorizations.expiresAt,new Date()))).returning();
        if(!attempt)throw new Error("Expired OAuth state");requestId=attempt.requestId;
        return await serial(`approval:${attempt.requestId}`,async()=>{
          const row=await readRequest(db.client,attempt.requestId);
          if(!["pending","verified"].includes(requestStatus(row)))throw new Error("Request already completed");
          const [session]=await db.client.select().from(sessions).where(and(eq(sessions.tokenHash,attempt.sessionHash),gt(sessions.expiresAt,new Date())));
          if(!session || session.address!==row.owner || attempt.owner!==row.owner)throw new Error("Owner session expired");
          if(urlParams.error || !urlParams.code || urlParams.code.length>4096) {
            await db.client.update(agentRequests).set({status:"cancelled"}).where(and(eq(agentRequests.id,row.id),inArray(agentRequests.status,["pending","verified"])));
            return {id:row.id,status:"cancelled"};
          }
          await validateRequest(db.client,row);
          const identity=await exchangeWorldCode(urlParams.code,attempt.verifier,attempt.nonce,attempt.createdAt);
          await db.client.transaction(async tx=>{
            await tx.insert(ownerIdentities).values({address:row.owner,id:randomUUID(),issuer:identity.issuer,subject:identity.subject}).onConflictDoNothing();
            const [bound]=await tx.select().from(ownerIdentities).where(eq(ownerIdentities.address,row.owner));
            if(!bound || bound.issuer!==identity.issuer || bound.subject!==identity.subject || (row.identityId && row.identityId!==bound.id))throw actionError("Verify with the same World identity used for this Space.");
            const saved=await tx.update(agentRequests).set({identityId:bound.id,status:"verified",verifiedAt:new Date(),verificationSession:attempt.sessionHash})
              .where(and(eq(agentRequests.id,row.id),inArray(agentRequests.status,["pending","verified"]),gt(agentRequests.expiresAt,new Date()))).returning();
            if(!saved.length)throw new Error("Request expired");
          });
          return {id:row.id,status:"verified"};
        });
      } catch { return {id:requestId,status:"failed"}; }
    });
    const destination=new URL(result.id?`/approvals/${result.id}`:"/",process.env.WEB_ORIGIN);
    destination.searchParams.set("world",result.status);
    return HttpServerResponse.redirect(destination.toString(),{status:303,headers:{"cache-control":"no-store","referrer-policy":"no-referrer"}});
  }))
  .handle("decide",({payload})=>Effect.gen(function*(){
    yield* requireBrowserOrigin();const session=yield* currentSession(),db=yield* Database;
    return yield* agentTry(()=>serial(`approval:${payload.id}`,async()=>{
      const row=await readRequest(db.client,payload.id),status=requestStatus(row);
      const canCancel=payload.decision==="cancel" && row.actor===session.address;
      if(row.owner!==session.address && !canCancel)throw actionError("Only the Space owner can approve this request.");
      if(!["pending","verified","approved"].includes(status))throw actionError(`This request is ${status}.`);
      if(payload.decision==="approve") {
        if(status==="approved")return requestView(db.client,row);
        if(status!=="verified" || !row.verifiedAt || row.verificationSession!==session.tokenHash || Date.now()-row.verifiedAt.getTime()>5*60_000)
          throw actionError("Complete a fresh World verification in this session first.");
        await validateRequest(db.client,row);
      }
      const [updated]=await db.client.update(agentRequests).set({status:payload.decision==="approve"?"approved":payload.decision==="deny"?"denied":"cancelled"})
        .where(and(eq(agentRequests.id,row.id),eq(agentRequests.status,row.status),gt(agentRequests.expiresAt,new Date()))).returning();
      if(!updated)throw actionError("This request changed. Refresh and try again.");
      return requestView(db.client,updated);
    }));
  })));
