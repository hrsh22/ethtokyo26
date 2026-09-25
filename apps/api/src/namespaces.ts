import { hierarchicalEnsPermissionAdapterAbi } from "@accord/chain";
import { eq } from "drizzle-orm";
import { createWalletClient, encodeFunctionData, getAddress, http, isAddress, keccak256, toBytes, zeroAddress, type Address, type Hex } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { labelhash, namehash } from "viem/ens";
import { adapterAddress, publicClient } from "./chain";
import type { DatabaseClient } from "./db";
import { namespaceDeployments, spaceNamespaces, type spaceDrafts } from "./db/schema";
import { ensFactoryAbi, ensFactoryAbiAddress, ensRegistryAbi, ensRegistryAbiAddress, ensResolverAbi, ensResolverAbiAddress, ENS_ROOT_ROLES } from "./ens-v2";
import { serial } from "./serial";

type Draft = typeof spaceDrafts.$inferSelect;
export function registrarWallet() {
  const key = process.env.ENS_REGISTRAR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("ENS registrar is not configured.");
  return createWalletClient({ account: privateKeyToAccount(key as Hex, { nonceManager }), chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL) });
}
export function namespaceName(draft: Pick<Draft, "spaceAddress" | "name">) {
  const slug = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0,18) || "space";
  const label = `${slug}-${draft.spaceAddress!.slice(2,10).toLowerCase()}`;
  const parent = process.env.ENS_NAMESPACE_NAME;
  if (!parent) throw new Error("ENS namespace is not configured.");
  return { label, name: `${label}.${parent}` };
}
export async function confirmed(hash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("The ENS transaction reverted. Please retry.");
  return receipt;
}
export async function registryState(registry: Address, label: string) {
  return publicClient.readContract({ address: registry, abi: ensRegistryAbi, functionName: "getState", args: [BigInt(labelhash(label))] });
}
async function deployProxy(db: DatabaseClient, id: string, implementation: Address, data: Hex) {
  const wallet = registrarWallet();
  const args = [implementation, BigInt(keccak256(toBytes(id))), data] as const;
  let [saved] = await db.select().from(namespaceDeployments).where(eq(namespaceDeployments.id,id));
  if (!saved) {
    const preview = await publicClient.simulateContract({ address: ensFactoryAbiAddress, abi: ensFactoryAbi,
      functionName: "deployProxy", args, account: wallet.account });
    [saved] = await db.insert(namespaceDeployments).values({ id, address: getAddress(preview.result) }).returning();
  }
  const address = getAddress(saved!.address);
  if (!await publicClient.getBytecode({ address })) {
    if (saved!.transactionHash) await confirmed(saved!.transactionHash as Hex);
    else {
      const hash = await wallet.writeContract({ address: ensFactoryAbiAddress, abi: ensFactoryAbi, functionName: "deployProxy", args });
      await db.update(namespaceDeployments).set({ transactionHash: hash }).where(eq(namespaceDeployments.id,id));
      await confirmed(hash);
    }
  }
  const actual = await publicClient.readContract({ address: ensFactoryAbiAddress, abi: ensFactoryAbi, functionName: "verifyContract", args: [address] });
  if (actual.toLowerCase() !== implementation.toLowerCase()) throw new Error("ENS implementation does not match the pinned deployment.");
  return address;
}

// Caller holds the registrar lock. All issued names are revocable, nontransferable,
// and have no registrar/resolver/renewal role. The backend is the namespace operator.
export async function ensureNamespace(db: DatabaseClient, draft: Draft) {
  const parentValue = process.env.ENS_NAMESPACE_REGISTRY;
  if (!parentValue || !isAddress(parentValue)) throw new Error("ENS namespace is not configured.");
  const parent = getAddress(parentValue), space = getAddress(draft.spaceAddress!);
  const wallet = registrarWallet(), { label, name } = namespaceName(draft);
  const registry = await deployProxy(db, `namespace:${space}`, ensRegistryAbiAddress,
    encodeFunctionData({ abi: ensRegistryAbi, functionName: "initialize", args: [wallet.account.address, ENS_ROOT_ROLES] }));
  const resolver = await deployProxy(db, `space-resolver:${space}`, ensResolverAbiAddress,
    encodeFunctionData({ abi: ensResolverAbi, functionName: "initialize", args: [wallet.account.address, ENS_ROOT_ROLES, [
      encodeFunctionData({ abi: ensResolverAbi, functionName: "setAddr", args: [namehash(name), space] }),
      encodeFunctionData({ abi: ensResolverAbi, functionName: "setText", args: [namehash(name), "description", `${draft.name} — Accord Space`] }),
      encodeFunctionData({ abi: ensResolverAbi, functionName: "setText", args: [namehash(name), "url", `${process.env.WEB_ORIGIN}/spaces/${space}`] }),
    ]] }));
  const state = await registryState(parent,label);
  if (state.status !== 2) {
    if (state.expiry !== 0n) throw new Error("This Space namespace has expired or was revoked. Create a new Space.");
    const expiry = BigInt(Math.floor(Date.now()/1000)+365*86400);
    await confirmed(await wallet.writeContract({ address: parent, abi: ensRegistryAbi, functionName: "register",
      args: [label, getAddress(draft.owner), registry, resolver, 0n, expiry] }));
  } else if (state.latestOwner.toLowerCase() !== draft.owner.toLowerCase()) throw new Error("The Space namespace has another owner.");
  const currentResolver = await publicClient.readContract({ address: parent, abi: ensRegistryAbi, functionName: "getResolver", args: [label] });
  if (currentResolver === zeroAddress) await confirmed(await wallet.writeContract({ address: parent, abi: ensRegistryAbi,
    functionName: "setResolver", args: [BigInt(labelhash(label)), resolver] }));
  else if (currentResolver.toLowerCase() !== resolver.toLowerCase()) throw new Error("The Space ENS resolver was changed.");
  const resolvedSpace = await publicClient.readContract({ address: resolver, abi: ensResolverAbi, functionName: "addr", args: [namehash(name)] });
  if (resolvedSpace.toLowerCase() !== space.toLowerCase()) throw new Error("The ENS name does not resolve to this Space.");
  const child = await publicClient.readContract({ address: parent, abi: ensRegistryAbi, functionName: "getSubregistry", args: [label] });
  if (child.toLowerCase()!==registry.toLowerCase()) throw new Error("The Space namespace was detached.");
  const currentParent = await publicClient.readContract({ address: registry, abi: ensRegistryAbi, functionName: "getParent" });
  if (currentParent[0]===zeroAddress) await confirmed(await wallet.writeContract({ address: registry, abi: ensRegistryAbi, functionName: "setParent", args: [parent,label] }));
  const binding = await publicClient.readContract({ address: adapterAddress(), abi: hierarchicalEnsPermissionAdapterAbi, functionName: "parents", args: [registry] });
  if (binding[0]===zeroAddress) await confirmed(await wallet.writeContract({ address: adapterAddress(), abi: hierarchicalEnsPermissionAdapterAbi, functionName: "bindNamespace", args: [registry,parent,label] }));
  const active = await publicClient.readContract({ address: adapterAddress(), abi: hierarchicalEnsPermissionAdapterAbi, functionName: "namespaceActive", args: [registry] });
  if (!active) throw new Error("The ENS namespace is no longer active.");
  await db.insert(spaceNamespaces).values({ spaceAddress: space, draftId:draft.id,name,registry }).onConflictDoNothing();
  return { registry,name };
}

export function provisionSpaceNamespace(db: DatabaseClient, draft: Draft) {
  return serial("ens-registrar", () => ensureNamespace(db, draft));
}

export function provisionAgent(db: DatabaseClient, draft: Draft, requestId: string, input: { label: string; agent: string; expiry: string }) {
  return serial("ens-registrar",async () => {
    const wallet=registrarWallet(), namespace=await ensureNamespace(db,draft);
    const agent=getAddress(input.agent), name=`${input.label}.${namespace.name}`;
    const expiry=BigInt(input.expiry), registry=namespace.registry;
    let state=await registryState(registry,input.label);
    // A used name can only be renewed for the same active identity. Revocation is final.
    if (state.status!==2 && state.expiry!==0n) throw new Error("That agent name was revoked or expired. Choose a new name.");
    if (state.status===2 && state.latestOwner.toLowerCase()!==agent.toLowerCase()) throw new Error("That agent name belongs to another wallet.");
    if (state.status!==2) {
      const setters=[
        encodeFunctionData({abi:ensResolverAbi,functionName:"setAddr",args:[namehash(name),agent]}),
        encodeFunctionData({abi:ensResolverAbi,functionName:"setText",args:[namehash(name),"description",`Agent for ${draft.name}`]}),
        encodeFunctionData({abi:ensResolverAbi,functionName:"setText",args:[namehash(name),"url",`${process.env.WEB_ORIGIN}/spaces/${draft.spaceAddress}`]}),
      ];
      const resolver=await deployProxy(db,`resolver:${requestId}`,ensResolverAbiAddress,
        encodeFunctionData({abi:ensResolverAbi,functionName:"initialize",args:[wallet.account.address,ENS_ROOT_ROLES,setters]}));
      await confirmed(await wallet.writeContract({address:registry,abi:ensRegistryAbi,functionName:"register",args:[input.label,agent,zeroAddress,resolver,0n,expiry]}));
    } else if (expiry>state.expiry) await confirmed(await wallet.writeContract({address:registry,abi:ensRegistryAbi,functionName:"renew",args:[BigInt(labelhash(input.label)),expiry]}));
    state=await registryState(registry,input.label);
    return {name,registry,nameId:BigInt(labelhash(input.label)),resource:state.resource};
  });
}
