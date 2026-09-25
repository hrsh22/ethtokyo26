/** Isolated protocol tests: World tokens/chain reads are fixtures, never live identity evidence. */
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createClient} from "@libsql/client";
import {drizzle} from "drizzle-orm/libsql";
import {migrate} from "drizzle-orm/libsql/migrator";
import {HttpApiBuilder,HttpServer} from "@effect/platform";
import {Layer} from "effect";
import {createHash,randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {eq} from "drizzle-orm";
import {getAddress,zeroAddress,type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {ApiLive} from "./app";
import {Database} from "./db";
import {agentPolicies,agentRequests,ownerIdentities,permitIntents,sessions,spaceDrafts} from "./db/schema";
import {publicClient} from "./chain";
import * as world from "./world-agents";

const addr=(d:string)=>getAddress(`0x${d.repeat(40)}`);
const owner=addr("1"),agent=addr("2"),space=addr("3"),token=addr("4"),adapter=addr("5"),registry=addr("6"),seller=addr("7");
const key=`0x${"0".repeat(63)}1` as Hex,authorizer=privateKeyToAccount(key).address;
const bearer="a".repeat(64),agentBearer="b".repeat(64),otherSession="c".repeat(64);
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const issuer="https://sandbox.auth.world.org",consumedGrant=`0x${"d".repeat(64)}`;
let connection:ReturnType<typeof createClient>,db:ReturnType<typeof drizzle>,api:ReturnType<typeof HttpApiBuilder.toWebHandler>;
let draftId:string,policyId:string,version:bigint,ensActive:boolean,consumed:boolean;
const expiry=()=>BigInt(Math.floor(Date.now()/1000)+86400);
beforeEach(async()=>{
  version=2n;ensActive=true;consumed=false;draftId=randomUUID();policyId=randomUUID();
  for(const [k,v] of Object.entries({PERMIT_SIGNER_PRIVATE_KEY:key,ENS_ADAPTER_ADDRESS:adapter,SPACE_FACTORY_ADDRESS:addr("8"),DEMO_TOKEN_ADDRESS:token,
    ENS_NAMESPACE_NAME:"accordspaces26.eth",WORLD_AGENTS_CLIENT_ID:"fixture",WORLD_AGENTS_PRIVATE_KEY_PATH:"/fixture",WORLD_AGENTS_REDIRECT_URI:"https://accord-api.hrsh.dev/v1/approvals/world/callback",WORLD_AGENTS_ISSUER:issuer,WORLD_AGENTS_TOKEN_ENDPOINT_AUTH_METHOD:"private_key_jwt",WEB_ORIGIN:"http://localhost:3000"}))vi.stubEnv(k,v);
  vi.spyOn(world,"exchangeWorldCode").mockResolvedValue({issuer,subject:"person-a"});
  vi.spyOn(publicClient,"getChainId").mockResolvedValue(11155111);
  vi.spyOn(publicClient,"getBytecode").mockResolvedValue("0x6000");
  vi.spyOn(publicClient,"getBlock").mockImplementation(async()=>({number:100n,timestamp:BigInt(Math.floor(Date.now()/1000))}) as never);
  vi.spyOn(publicClient,"simulateContract").mockResolvedValue({} as never);
  vi.spyOn(publicClient,"readContract").mockImplementation(async args=>{
    const values:Record<string,unknown>={owner,authorizer,token,ensAdapter:adapter,policyVersion:version,agentApprovalVersion:1n,
      allocations:[zeroAddress,100_000_000n,100_000_000n,0n,0n,0,false],
      mandates:[agent,registry,1n,2n,100_000_000n,50_000_000n,0n,0n,expiry(),true],isAuthorized:ensActive,
      consumedRequests:args.args?.[0]===consumedGrant?true:consumed,consumedNonces:consumed};
    return values[args.functionName];
  });
  connection=createClient({url:":memory:"});db=drizzle(connection);
  await migrate(db,{migrationsFolder:fileURLToPath(new URL("../drizzle-sqlite",import.meta.url))});
  await db.insert(sessions).values([{tokenHash:hash(bearer),address:owner.toLowerCase(),expiresAt:new Date(Date.now()+3600000)},
    {tokenHash:hash(agentBearer),address:agent.toLowerCase(),expiresAt:new Date(Date.now()+3600000)},
    {tokenHash:hash(otherSession),address:owner.toLowerCase(),expiresAt:new Date(Date.now()+3600000)}]);
  await db.insert(spaceDrafts).values({id:draftId,owner:owner.toLowerCase(),name:"Team",templateId:"research-budget",spaceAddress:space,tokenAddress:token,activatedAt:new Date(),deploymentTx:`0x${"e".repeat(64)}`});
  await db.insert(ownerIdentities).values({address:owner.toLowerCase(),id:"person-binding",issuer,subject:"person-a"});
  await db.insert(agentPolicies).values({requestId:policyId,spaceAddress:space,allocationId:"1",name:"research.team.accordspaces26.eth",agent,registry,nameId:"1",resource:"2",dailyCap:"100000000",maxPerPayment:"50000000",approvalThreshold:"10000000",expiry:expiry().toString(),permitRequestId:consumedGrant});
  api=HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive.pipe(Layer.provide(Layer.succeed(Database,{client:db}))),HttpServer.layerContext));
});
afterEach(async()=>{await api.dispose();connection.close();vi.restoreAllMocks();vi.unstubAllEnvs();});
async function post(path:string,payload:unknown,auth=bearer){return api.handler(new Request(`http://localhost${path}`,{method:"POST",headers:{authorization:`Bearer ${auth}`,"content-type":"application/json"},body:JSON.stringify(payload)}));}
const payment=(requestKey=randomUUID(),amount="20000000")=>({draftId,allocationId:"1",requestKey,recipient:seller,amount});
async function pending(){const payload=payment(),r=await post("/v1/permits/payments",payload,agentBearer);expect(r.status).toBe(409);const {request}=await r.json();return {payload,id:request.id as string};}
async function authenticate(id:string){const start=await post("/v1/approvals/world/start",{id});expect(start.status).toBe(200);const {url}=await start.json();const state=new URL(url).searchParams.get("state");return api.handler(new Request(`http://localhost/v1/approvals/world/callback?state=${state}&code=fixture`));}
async function approve(id:string){expect((await authenticate(id)).headers.get("location")).toContain("world=verified");expect((await post("/v1/approvals/decide",{id,decision:"approve"})).status).toBe(200);}

describe("joint ENS and World approval protocol",()=>{
  it("allows routine payments without inventing screening results",async()=>{
    const r=await post("/v1/permits/payments",payment(randomUUID(),"5000000"),agentBearer);expect(r.status).toBe(200);
    const body=await r.json();expect(body.signature).toMatch(/^0x/);expect(body.riskVerdict).toBeUndefined();expect(body.decision).toBeUndefined();
    expect(await db.select().from(agentRequests)).toHaveLength(0);
  });
  it("requires fresh authentication AND explicit consent; exact retries reuse one permit",async()=>{
    const {payload,id}=await pending();expect(await db.select().from(permitIntents)).toHaveLength(0);
    expect((await post("/v1/approvals/decide",{id,decision:"approve"})).status).toBe(400);
    expect((await authenticate(id)).headers.get("location")).toContain("world=verified");
    expect((await post("/v1/permits/payments",payload,agentBearer)).status).toBe(409);
    expect((await post("/v1/approvals/decide",{id,decision:"approve"},otherSession)).status).toBe(400);
    expect((await post("/v1/approvals/decide",{id,decision:"approve"})).status).toBe(200);
    const first=await post("/v1/permits/payments",payload,agentBearer),again=await post("/v1/permits/payments",payload,agentBearer);
    expect(first.status).toBe(200);expect(await again.json()).toEqual(await first.json());expect(await db.select().from(permitIntents)).toHaveLength(1);
    consumed=true;expect((await post("/v1/permits/payments",payload,agentBearer)).status).not.toBe(200);
  });
  it.each(["deny","cancel"])("%s prevents payment while ENS remains valid",async decision=>{
    const {payload,id}=await pending();expect((await post("/v1/approvals/decide",{id,decision})).status).toBe(200);
    expect((await post("/v1/permits/payments",payload,agentBearer)).status).toBe(400);expect(await db.select().from(permitIntents)).toHaveLength(0);
  });
  it("rejects changed amount, recipient, and wrong owner",async()=>{
    const {payload,id}=await pending();await approve(id);
    for(const patch of [{amount:"20000001"},{recipient:token}])expect((await post("/v1/permits/payments",{...payload,...patch},agentBearer)).status).toBe(400);
    expect((await post("/v1/approvals/decide",{id,decision:"approve"},agentBearer)).status).toBe(400);
    expect(await db.select().from(permitIntents)).toHaveLength(0);
  });
  it("approval cannot rescue revoked ENS, including cached signatures",async()=>{
    const {payload,id}=await pending();await approve(id);
    expect((await post("/v1/permits/payments",payload,agentBearer)).status).toBe(200);
    ensActive=false;expect((await post("/v1/permits/payments",payload,agentBearer)).status).toBe(400);
    expect(await db.select().from(permitIntents)).toHaveLength(1);
  });
  it("rejects policy changes and expired requests",async()=>{
    const {payload,id}=await pending();await approve(id);version=3n;
    expect((await post("/v1/permits/payments",payload,agentBearer)).status).toBe(400);version=2n;
    await db.update(agentRequests).set({expiresAt:new Date(Date.now()-1)}).where(eq(agentRequests.id,id));
    expect((await post("/v1/permits/payments",payload,agentBearer)).status).toBe(400);
    expect(await db.select().from(permitIntents)).toHaveLength(0);
  });
  it("rejects a different World person and reusing an OAuth callback",async()=>{
    const {id}=await pending();vi.mocked(world.exchangeWorldCode).mockResolvedValue({issuer,subject:"person-b"});
    const start=await post("/v1/approvals/world/start",{id}),{url}=await start.json(),state=new URL(url).searchParams.get("state");
    const callback=()=>api.handler(new Request(`http://localhost/v1/approvals/world/callback?state=${state}&code=fixture`));
    expect((await callback()).headers.get("location")).toContain("world=failed");
    expect((await callback()).headers.get("location")).toContain("world=failed");expect(world.exchangeWorldCode).toHaveBeenCalledTimes(1);
    expect((await post("/v1/approvals/decide",{id,decision:"approve"})).status).toBe(400);
  });
  it("a late callback cannot revive a denied request",async()=>{
    const {id}=await pending(),start=await post("/v1/approvals/world/start",{id}),{url}=await start.json(),state=new URL(url).searchParams.get("state");
    await post("/v1/approvals/decide",{id,decision:"deny"});
    await api.handler(new Request(`http://localhost/v1/approvals/world/callback?state=${state}&code=fixture`));
    expect(world.exchangeWorldCode).not.toHaveBeenCalled();expect((await db.select().from(agentRequests))[0]!.status).toBe("denied");
  });
  it("cannot grant through the old raw mandate endpoint or fund without review",async()=>{
    const raw=await post("/v1/admin/mandates",{draftId,allocationId:"1",requestKey:randomUUID(),agent,registry,nameId:"1",expectedResource:"2",dailyCap:"100000000",maxPerPayment:"50000000",expiry:expiry().toString()});expect(raw.status).toBe(403);
    const fund=await post("/v1/agents/fund",{draftId,allocationId:"1",requestKey:randomUUID(),amount:"1000000"});expect(fund.status).toBe(200);
    const row=await fund.json();expect(row.status).toBe("pending");expect((await post("/v1/agents/issue",{id:row.id})).status).toBe(400);
  });
});
