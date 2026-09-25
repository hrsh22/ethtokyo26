import { sepolia } from "viem/chains";

export { spaceAccountAbi, spaceFactoryAbi, ensPermissionAdapterAbi } from "./generated";
export * from "./permit";
export * from "./allocation-window";

export const accordChain = sepolia;
export const accordChainId = sepolia.id;
