/** Sepolia migration: retain tUSDC/forwarder; deploy the namespace, adapter and new factory. */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {createPublicClient,createWalletClient,encodeFunctionData,erc20Abi,formatEther,getAddress,http,keccak256,parseAbi,toBytes,zeroAddress,zeroHash,type Abi,type Address,type Hex} from "viem";
import {privateKeyToAccount,nonceManager} from "viem/accounts";
import {sepolia} from "viem/chains";
import {labelhash} from "viem/ens";
import {ensFactoryAbi,ensFactoryAbiAddress,ensRegistryAbi,ensRegistryAbiAddress,ensResolverAbiAddress,ENS_ROOT_REGISTRY,ENS_ROOT_ROLES} from "../src/ens-v2";
import {hierarchicalEnsPermissionAdapterAbi} from "@accord/chain";

const broadcast=process.argv.includes("--broadcast");
const key=process.env.ENS_REGISTRAR_PRIVATE_KEY||process.env.DEPLOYER_PRIVATE_KEY;
if(!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !process.env.SEPOLIA_RPC_URL)throw new Error("Configure the registrar and Sepolia RPC in the backend environment.");
const account=privateKeyToAccount(key as Hex,{nonceManager}),client=createPublicClient({chain:sepolia,transport:http(process.env.SEPOLIA_RPC_URL)}),wallet=createWalletClient({account,chain:sepolia,transport:http(process.env.SEPOLIA_RPC_URL)});
const label=process.env.ENS_NAMESPACE_LABEL??"accordspaces26",registrar="0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca",mockUsdc="0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e";
const manifestUrl=new URL("../../../deployments/ens-world-sepolia.json",import.meta.url);
const secretUrl=new URL("/home/accord-api/.config/accord/ens-registration-secret",import.meta.url);
let state:Record<string,string>={};try{state=JSON.parse(await readFile(manifestUrl,"utf8"));}catch{/* first deployment */}
async function save(){await mkdir(new URL("../../../deployments/",import.meta.url),{recursive:true});await writeFile(manifestUrl,JSON.stringify(state,null,2)+"\n");}
async function confirmed(hash:Hex){const r=await client.waitForTransactionReceipt({hash,timeout:180000});if(r.status!=="success")throw new Error(`Transaction reverted: ${hash}`);return r;}
async function artifact(name:string){const d=JSON.parse(await readFile(new URL(`../../../contracts/out/${name}.sol/${name}.json`,import.meta.url),"utf8"));return {abi:d.abi as Abi,bytecode:d.bytecode.object as Hex};}
async function deploy(name:string,args:readonly unknown[]){
  if(state[name]){if(!await client.getBytecode({address:getAddress(state[name]!)}))throw new Error(`${name} has no bytecode`);return getAddress(state[name]!);}
  const data=await artifact(name);let hash=state[`${name}Tx`] as Hex|undefined;
  if(!hash){hash=await wallet.deployContract({...data,args});state[`${name}Tx`]=hash;await save();console.log(`${name}: ${hash}`);}
  const receipt=await confirmed(hash);if(!receipt.contractAddress)throw new Error("No deployed address");
  state[name]=getAddress(receipt.contractAddress);state[`${name}BytecodeHash`]=keccak256(data.bytecode);await save();return getAddress(receipt.contractAddress);
}
const registrarAbi=parseAbi([
  "function ETH_REGISTRY() view returns (address)","function MIN_COMMITMENT_AGE() view returns (uint64)",
  "function getRegisterPrice(string label,uint64 duration,address paymentToken) view returns (uint256 base,uint256 premium)",
  "function makeCommitment(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,bytes32 referrer) pure returns(bytes32)",
  "function commitmentAt(bytes32 commitment) view returns(uint64)","function commit(bytes32 commitment)",
  "function register(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,address paymentToken,bytes32 referrer) returns(uint256)",
]);
async function main(){
  if(await client.getChainId()!==11155111)throw new Error("Expected Sepolia");
  for(const address of [ensFactoryAbiAddress,ensRegistryAbiAddress,ensResolverAbiAddress,ENS_ROOT_REGISTRY])if(!await client.getBytecode({address}))throw new Error(`Missing ENS contract ${address}`);
  if((await client.readContract({address:registrar,abi:registrarAbi,functionName:"ETH_REGISTRY"})).toLowerCase()!==ENS_ROOT_REGISTRY)throw new Error("Registrar/root mismatch");
  const current=await client.readContract({address:ENS_ROOT_REGISTRY,abi:ensRegistryAbi,functionName:"getState",args:[BigInt(labelhash(label))]});
  if(current.status===2 && current.latestOwner.toLowerCase()!==account.address.toLowerCase())throw new Error("Namespace name is owned by another account");
  const balance=await client.getBalance({address:account.address});
  console.log(JSON.stringify({mode:broadcast?"broadcast":"dry-run",operator:account.address,balance:formatEther(balance),name:`${label}.eth`,existing:current.status===2}));
  if(!broadcast)return;
  if(balance<1_000_000_000_000_000n)throw new Error("Registrar needs Sepolia ETH");
  state.chainId="11155111";state.namespaceName=`${label}.eth`;state.operator=account.address;state.rootRegistry=ENS_ROOT_REGISTRY;
  state.ensCommit="48b3e2d39513b9dd32ef1850877a29009bc807b9";state.registryImplementation=ensRegistryAbiAddress;state.resolverImplementation=ensResolverAbiAddress;state.verifiableFactory=ensFactoryAbiAddress;
  state.token=getAddress(process.env.DEMO_TOKEN_ADDRESS!);state.forwarder=getAddress(process.env.FORWARDER_ADDRESS!);
  if(!state.namespaceRegistry){
    const args=[ensRegistryAbiAddress,BigInt(keccak256(toBytes(`accord-root:${label}:v1`))),encodeFunctionData({abi:ensRegistryAbi,functionName:"initialize",args:[account.address,ENS_ROOT_ROLES]})] as const;
    if(!state.namespacePredicted){const preview=await client.simulateContract({address:ensFactoryAbiAddress,abi:ensFactoryAbi,functionName:"deployProxy",args,account});state.namespacePredicted=preview.result;await save();}
    const predicted=getAddress(state.namespacePredicted!);
    if(!await client.getBytecode({address:predicted})){
      let hash=state.namespaceTx as Hex|undefined;if(!hash){hash=await wallet.writeContract({address:ensFactoryAbiAddress,abi:ensFactoryAbi,functionName:"deployProxy",args});state.namespaceTx=hash;await save();console.log(`Namespace registry: ${hash}`);}await confirmed(hash);
    }
    const impl=await client.readContract({address:ensFactoryAbiAddress,abi:ensFactoryAbi,functionName:"verifyContract",args:[predicted]});
    if(impl.toLowerCase()!==ensRegistryAbiAddress)throw new Error("Namespace implementation mismatch");state.namespaceRegistry=predicted;await save();
  }
  const namespace=getAddress(state.namespaceRegistry!);
  if(current.status!==2){
    let secret:Hex;try{secret=(await readFile(secretUrl,"utf8")).trim() as Hex;}catch{secret=`0x${randomBytes(32).toString("hex")}`;await writeFile(secretUrl,secret,{mode:0o600});}
    const duration=31536000n,[base,premium]=await client.readContract({address:registrar,abi:registrarAbi,functionName:"getRegisterPrice",args:[label,duration,mockUsdc]}),price=base+premium;
    const balance=await client.readContract({address:mockUsdc,abi:erc20Abi,functionName:"balanceOf",args:[account.address]});
    if(balance<price)await confirmed(await wallet.writeContract({address:mockUsdc,abi:parseAbi(["function mint(address,uint256)"]),functionName:"mint",args:[account.address,price-balance]}));
    const allowance=await client.readContract({address:mockUsdc,abi:erc20Abi,functionName:"allowance",args:[account.address,registrar]});
    if(allowance<price)await confirmed(await wallet.writeContract({address:mockUsdc,abi:erc20Abi,functionName:"approve",args:[registrar,price]}));
    const commitment=await client.readContract({address:registrar,abi:registrarAbi,functionName:"makeCommitment",args:[label,account.address,secret,namespace,zeroAddress,duration,zeroHash]});
    let committed=await client.readContract({address:registrar,abi:registrarAbi,functionName:"commitmentAt",args:[commitment]});
    if(committed===0n){const hash=await wallet.writeContract({address:registrar,abi:registrarAbi,functionName:"commit",args:[commitment]});await confirmed(hash);state.commitTx=hash;await save();committed=await client.readContract({address:registrar,abi:registrarAbi,functionName:"commitmentAt",args:[commitment]});}
    const minimum=await client.readContract({address:registrar,abi:registrarAbi,functionName:"MIN_COMMITMENT_AGE"});
    console.log("Waiting for ENS commitment age");while((await client.getBlock()).timestamp<committed+minimum)await delay(5000);
    const args=[label,account.address,secret,namespace,zeroAddress,duration,mockUsdc,zeroHash] as const;
    await client.simulateContract({address:registrar,abi:registrarAbi,functionName:"register",args,account});
    const hash=await wallet.writeContract({address:registrar,abi:registrarAbi,functionName:"register",args});await confirmed(hash);state.registerTx=hash;await save();console.log(`Registered ${label}.eth: ${hash}`);
  }
  const child=await client.readContract({address:ENS_ROOT_REGISTRY,abi:ensRegistryAbi,functionName:"getSubregistry",args:[label]});
  if(child===zeroAddress)await confirmed(await wallet.writeContract({address:ENS_ROOT_REGISTRY,abi:ensRegistryAbi,functionName:"setSubregistry",args:[BigInt(labelhash(label)),namespace]}));
  else if(child.toLowerCase()!==namespace.toLowerCase())throw new Error("Parent points to another registry");
  const parent=await client.readContract({address:namespace,abi:ensRegistryAbi,functionName:"getParent"});
  if(parent[0]===zeroAddress)await confirmed(await wallet.writeContract({address:namespace,abi:ensRegistryAbi,functionName:"setParent",args:[ENS_ROOT_REGISTRY,label]}));
  const adapter=await deploy("HierarchicalEnsPermissionAdapter",[ENS_ROOT_REGISTRY,account.address]);
  const binding=await client.readContract({address:adapter,abi:hierarchicalEnsPermissionAdapterAbi,functionName:"parents",args:[namespace]});
  if(binding[0]===zeroAddress)await confirmed(await wallet.writeContract({address:adapter,abi:hierarchicalEnsPermissionAdapterAbi,functionName:"bindNamespace",args:[namespace,ENS_ROOT_REGISTRY,label]}));
  if(!await client.readContract({address:adapter,abi:hierarchicalEnsPermissionAdapterAbi,functionName:"namespaceActive",args:[namespace]}))throw new Error("Root namespace is not active");
  await deploy("SpaceFactory",[state.forwarder]);state.completedAt=new Date().toISOString();await save();
  console.log(JSON.stringify({namespace:state.namespaceName,namespaceRegistry:namespace,adapter:state.HierarchicalEnsPermissionAdapter,factory:state.SpaceFactory}));
}
await main().catch(error=>{console.error(error.name, error.shortMessage??error.message);process.exitCode=1;});
