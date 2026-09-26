/** Live Sepolia demo driver. Uses real API/OIDC; never inserts a verified identity or policy. */
import {readFile,writeFile} from "node:fs/promises";
import {createAccordClient,paymentApprovalRequired} from "../../../packages/sdk/src/index";
import {accordForwarderAbi,spaceFactoryAbi,spaceAccountAbi} from "@accord/chain";
import {createPublicClient,createWalletClient,decodeFunctionData,encodeFunctionData,erc20Abi,getAddress,http,zeroAddress,type Address,type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {sepolia} from "viem/chains";
const mode=process.argv[2]??"prepare",base="https://accord-api.hrsh.dev";
const owner=privateKeyToAccount(process.env.DEMO_HUMAN_PRIVATE_KEY as Hex),agent=privateKeyToAccount(process.env.DEMO_AGENT_PRIVATE_KEY as Hex);
const chain=createPublicClient({chain:sepolia,transport:http(process.env.SEPOLIA_RPC_URL)});
const file=new URL("../../../.data/ens-world-demo-session.json",import.meta.url);
let state:Record<string,any>={};try{state=JSON.parse(await readFile(file,"utf8"));}catch{/* initial run */}
async function save(){await writeFile(file,JSON.stringify(state,null,2)+"\n",{mode:0o600});}
async function login(account:typeof owner,key:string){
  const publicApi=await createAccordClient(base);
  if(state[key]){const r=await fetch(`${base}/v1/auth/session`,{headers:{authorization:`Bearer ${state[key]}`}});if(!r.ok)delete state[key];}
  // Controlled historical wallet fixture. External agents use the separately
  // paired/scoped toolkit; this driver deliberately exercises general wallet API.
  if(!state[key]){
    const c=await publicApi.createChallenge(account.address);
    const r=await fetch(`${base}/v1/auth/verify`,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({id:c.id,address:account.address,signature:await account.signMessage({message:c.message}),client:"browser"})});
    if(!r.ok)throw new Error("Demo wallet sign-in failed");
    state[key]=r.headers.get("set-cookie")?.match(/accord_session=([a-f0-9]{64})/)?.[1];
    if(!state[key])throw new Error("Demo wallet session missing");await save();
  }
  return createAccordClient(base,{bearerToken:state[key]});
}
const api=await login(owner,"ownerSession"),agentApi=await login(agent,"agentSession"),config=await api.config();
const forwarder=getAddress(config.forwarderAddress!),token=getAddress(config.demoTokenAddress!);
async function mined(hash:Hex){const r=await chain.waitForTransactionReceipt({hash,timeout:180000});if(r.status!=="success")throw new Error(`Transaction reverted: ${hash}`);return r;}
async function relay(account:typeof owner,client:typeof api,to:Address,data:Hex,gas=1_500_000n){
  const nonce=await chain.readContract({address:forwarder,abi:accordForwarderAbi,functionName:"nonces",args:[account.address]}),deadline=Math.floor(Date.now()/1000)+300;
  const signature=await account.signTypedData({domain:{name:"AccordForwarder",version:"1",chainId:11155111,verifyingContract:forwarder},primaryType:"ForwardRequest",
    types:{ForwardRequest:[{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},{name:"gas",type:"uint256"},{name:"nonce",type:"uint256"},{name:"deadline",type:"uint48"},{name:"data",type:"bytes"}]},
    message:{from:account.address,to,value:0n,gas,nonce,deadline,data}});
  const r=await client.relay({from:account.address,to,value:"0",gas:String(gas),nonce:String(nonce),deadline:String(deadline),data,signature});
  console.log("Sponsored transaction",r.transactionHash);await mined(r.transactionHash as Hex);return r.transactionHash;
}
async function main(){
  if(mode==="prepare"){
    if(!state.faucet){state.faucet=(await api.claimTestUSDC()).transactionHash;await save();await mined(state.faucet);}
    if(!state.draft){state.draft=await api.createDraft({name:"Tokyo Team",templateId:"research-budget"});await save();}
    if(!state.spaceTx){state.spaceTx=await relay(owner,api,getAddress(config.factoryAddress!),encodeFunctionData({abi:spaceFactoryAbi,functionName:"createSpace",args:[getAddress(config.authorizerAddress!),token,getAddress(config.adapterAddress!)]}),3_500_000n);await save();}
    if(!state.space){state.space=(await api.activateSpace({draftId:state.draft.id,deploymentTx:state.spaceTx})).spaceAddress;await save();}
    if(!state.funding){state.funding=await api.createAllocation({draftId:state.draft.id,requestKey:crypto.randomUUID(),beneficiary:zeroAddress,amount:"100000000",periodCap:"100000000",period:0});await save();}
    if(!state.fundingTx){await relay(owner,api,token,encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[getAddress(state.space),100_000_000n]}));state.fundingTx=await relay(owner,api,getAddress(state.space),state.funding.calldata);await save();}
    const current=state.grant?await api.approval(state.grant.id):null;
    if(!current || ["expired","cancelled","denied"].includes(current.status)){
      state.grant=await api.prepareAgent({draftId:state.draft.id,allocationId:state.funding.permit.allocationId,requestKey:crypto.randomUUID(),label:"research",agent:agent.address,dailyCap:"100000000",maxPerPayment:"50000000",approvalThreshold:"10000000",expiry:String(Math.floor(Date.now()/1000)+14*86400)});await save();
    }
    const {url}=await api.authenticateApproval(state.grant.id);await writeFile(new URL("../../../.data/world-demo-auth-url",import.meta.url),url,{mode:0o600});
    console.log(JSON.stringify({space:state.space,allocationId:state.grant.allocationId,requestId:state.grant.id,name:state.grant.agentName,status:"awaiting-real-World-authentication"}));
  }else if(mode==="issue"){
    const current=await api.approval(state.grant.id);
    if(current.status==="verified")await api.decideApproval(current.id,"approve");
    const envelope=await api.issueAgentRequest(current.id);state.grantTx=await relay(owner,api,getAddress(state.space),envelope.calldata as Hex);await save();
    console.log(JSON.stringify(await api.agentIdentities(state.draft.id)));
  }else if(mode==="status"){
    console.log(JSON.stringify({space:state.space,grant:state.grant?await api.approval(state.grant.id):null,identities:state.draft?await api.agentIdentities(state.draft.id):null}));
  }else if(mode==="request-payment"){
    state.payment={draftId:state.draft.id,allocationId:state.funding.permit.allocationId,requestKey:crypto.randomUUID(),amount:"20000000",recipient:getAddress(process.env.RESEARCH_SELLER_ADDRESS!)};await save();
    try{await agentApi.authorizePayment(state.payment);throw new Error("Sensitive payment unexpectedly received a signature");}catch(error){const pending=paymentApprovalRequired(error);if(!pending)throw error;state.paymentApproval=pending.id;await save();console.log(JSON.stringify({requestId:pending.id,status:pending.status}));}
  }else if(mode==="authenticate-payment"){
    const {url}=await api.authenticateApproval(state.paymentApproval);await writeFile(new URL("../../../.data/world-demo-auth-url",import.meta.url),url,{mode:0o600});console.log("World payment authentication ready");
  }else if(mode==="approve-payment" || mode==="cache-payment"){
    const request=await api.approval(state.paymentApproval);if(request.status==="verified")await api.decideApproval(request.id,"approve");
    state.authorization=await agentApi.authorizePayment(state.payment);await save();
    if(mode==="approve-payment")await pay(state.authorization,"approvedPaymentTx");else console.log("Approved payment signature saved for the revocation test");
  }else if(mode==="routine"){
    const p={draftId:state.draft.id,allocationId:state.funding.permit.allocationId,requestKey:crypto.randomUUID(),amount:"1000000",recipient:getAddress(process.env.RESEARCH_SELLER_ADDRESS!)};
    const result=await agentApi.authorizePayment(p);if(!result.signature || result.riskVerdict!==undefined)throw new Error("Unexpected authorization result");await pay(result,"routinePaymentTx");
  }else if(mode==="deny"){
    await api.decideApproval(state.paymentApproval,"deny");
    try{await agentApi.authorizePayment(state.payment);throw new Error("Denied request returned a signature");}catch(error){if((error as any)._tag!=="AgentActionError")throw error;state.deniedRequest=state.paymentApproval;await save();console.log("Denied payment rejected while ENS identity is active");}
  }else if(mode==="revoke-cached"){
    if(Number(state.authorization?.permit?.expiry)<=Math.floor(Date.now()/1000)+60)throw new Error("Cache a fresh approved permit before the revocation test");
    if(!state.ensRevocationTx){state.ensRevocationTx=(await api.revokeAgentIdentity(state.draft.id,state.funding.permit.allocationId)).transactionHash;await save();}
    let rejected=false;try{await agentApi.authorizePayment(state.payment);}catch(error){rejected=(error as any)._tag==="AgentActionError";}if(!rejected)throw new Error("Revoked ENS identity was not rejected by API");
    const result=state.authorization,data=paymentData(result);
    let invalidEns=false;
    try{await chain.simulateContract({account:agent.address,address:getAddress(state.space),abi:spaceAccountAbi,...decodeFunctionData({abi:spaceAccountAbi,data})});}catch(error){
      let cause:any=error;while(cause){if(cause.data?.errorName==="InvalidEnsAuthority")invalidEns=true;cause=cause.cause;}
      if(!invalidEns)console.log("Unexpected simulation rejection",(error as any).shortMessage);
    }
    // Inspect the custom error, so expiry or a depleted budget cannot explain this rejection.
    if(!invalidEns)throw new Error("Expected InvalidEnsAuthority from the revoked identity");
    const wallet=createWalletClient({account:agent,chain:sepolia,transport:http(process.env.SEPOLIA_RPC_URL)});
    // Deliberate onchain failure for evidence, using only the test agent's Sepolia ETH.
    const tx=await wallet.sendTransaction({to:getAddress(state.space),data,gas:500000n});
    const receipt=await chain.waitForTransactionReceipt({hash:tx});if(receipt.status!=="reverted")throw new Error("Cached payment unexpectedly executed");
    const block=await chain.getBlock({blockNumber:receipt.blockNumber});
    if(block.timestamp>=BigInt(result.permit.expiry))throw new Error("Cached permit expired before the rejection was mined");
    state.cachedPaymentRevertedTx=tx;state.cachedPaymentRevertReason="InvalidEnsAuthority";await save();console.log(JSON.stringify({ensRevocationTx:state.ensRevocationTx,cachedPaymentRevertedTx:tx,status:receipt.status,reason:state.cachedPaymentRevertReason}));
  }else throw new Error("Unknown demo action");
}
function paymentData(result:any){const p=result.permit;return encodeFunctionData({abi:spaceAccountAbi,functionName:"pay",args:[BigInt(p.allocationId),getAddress(p.recipient),BigInt(p.amount),{...p,actor:getAddress(p.actor),recipient:getAddress(p.recipient),allocationId:BigInt(p.allocationId),amount:BigInt(p.amount),nonce:BigInt(p.nonce),expiry:BigInt(p.expiry),policyVersion:BigInt(p.policyVersion)},result.signature]});}
async function pay(result:any,label:string){state[label]=await relay(agent,agentApi,getAddress(state.space),paymentData(result));await save();console.log(label,state[label]);}
await main().catch(error=>{console.error(error._tag??error.name,error.message??"Action failed");process.exitCode=1;});
