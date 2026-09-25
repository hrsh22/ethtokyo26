/** Read/simulate only: verify a managed agent's actual ENSv2 permissions and resolver. */
import {readFile} from "node:fs/promises";
import {createAccordClient} from "../../../packages/sdk/src/index";
import {publicClient} from "../src/chain";
import {ensRegistryAbi,ensResolverAbi} from "../src/ens-v2";
import {BaseError,ContractFunctionRevertedError,getAddress,parseAbi,zeroAddress} from "viem";
import {namehash} from "viem/ens";
const demo=JSON.parse(await readFile(new URL("../../../.data/ens-world-demo-session.json",import.meta.url),"utf8"));
const api=await createAccordClient("https://accord-api.hrsh.dev"),identities=await api.agentIdentities(demo.draft.id),identity=identities.identities[0]!;
const registry=getAddress(identity.registry),agent=getAddress(identity.agent),label=identity.name.split(".")[0]!;
const state=await publicClient.readContract({address:registry,abi:ensRegistryAbi,functionName:"getState",args:[BigInt(identity.nameId)]});
const resolver=await publicClient.readContract({address:registry,abi:ensRegistryAbi,functionName:"getResolver",args:[label]});
if(!identity.active || resolver===zeroAddress)throw new Error("Identity is not active/resolvable");
const address=await publicClient.readContract({address:resolver,abi:ensResolverAbi,functionName:"addr",args:[namehash(identity.name)]});
if(address.toLowerCase()!==agent.toLowerCase())throw new Error("Agent address record mismatch");
const resolved=await api.resolveEnsRecipient(identity.name);if(resolved.address.toLowerCase()!==agent.toLowerCase())throw new Error("Universal resolution mismatch");
async function denied(name:string,call:()=>Promise<unknown>){try{await call();}catch(error){const revert=error instanceof BaseError?error.walk(e=>e instanceof ContractFunctionRevertedError):undefined;const reason=revert instanceof ContractFunctionRevertedError?revert.data?.errorName:undefined;if(reason?.startsWith("EAC")||reason==="TransferDisallowed"){console.log(`${name}: rejected (${reason})`);return; }throw error;}throw new Error(`${name} unexpectedly allowed`);}
await denied("Agent renewal",()=>publicClient.simulateContract({address:registry,abi:ensRegistryAbi,functionName:"renew",args:[BigInt(identity.nameId),state.expiry+100n],account:agent}));
await denied("Agent subregistry replacement",()=>publicClient.simulateContract({address:registry,abi:ensRegistryAbi,functionName:"setSubregistry",args:[BigInt(identity.nameId),registry],account:agent}));
await denied("Agent resolver replacement",()=>publicClient.simulateContract({address:registry,abi:ensRegistryAbi,functionName:"setResolver",args:[BigInt(identity.nameId),zeroAddress],account:agent}));
await denied("Agent transfer",()=>publicClient.simulateContract({address:registry,abi:[...ensRegistryAbi,...parseAbi(["function safeTransferFrom(address,address,uint256,uint256,bytes)"])],functionName:"safeTransferFrom",args:[agent,getAddress(demo.draft.owner),state.tokenId,1n,"0x"],account:agent}));
await denied("Agent metadata edit",()=>publicClient.simulateContract({address:resolver,abi:ensResolverAbi,functionName:"setText",args:[namehash(identity.name),"url","https://example.invalid"],account:agent}));
console.log(JSON.stringify({name:identity.name,registry,resolver,address,resolves:true,restricted:true}));
