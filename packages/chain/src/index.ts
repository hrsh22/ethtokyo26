import { sepolia } from "viem/chains";

export { spaceAccountAbi, spaceFactoryAbi, ensPermissionAdapterAbi, hierarchicalEnsPermissionAdapterAbi, accordForwarderAbi, accordTestUSDCAbi } from "./generated";
export * from "./permit";
export * from "./allocation-window";

export const accordChain = sepolia;
export const accordChainId = sepolia.id;
