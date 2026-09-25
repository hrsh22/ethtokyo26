"use client";

import { accordForwarderAbi } from "@accord/chain";
import { getAddress, parseAbi, type Address, type Hex } from "viem";
import { usePublicClient, useSignTypedData } from "wagmi";
import { SEPOLIA_CHAIN_ID, useAccord } from "./accord";

const forwarderTargetAbi = parseAbi(["function isTrustedForwarder(address) view returns (bool)"]);
const forwardRequestTypes = {
  ForwardRequest: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "value", type: "uint256" }, { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

/** Sends a signed ERC-2771 request through Accord's gas sponsor when the target trusts it. */
export function useSponsoredTransaction() {
  const { account, auth, client, config } = useAccord();
  const chain = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const { signTypedDataAsync } = useSignTypedData();

  async function send(to: Address, data: Hex, gas = BigInt(1_500_000)): Promise<Hex> {
    if (!account || !auth.signedIn || !chain) throw new Error("Sign in with your wallet first.");
    const forwarderValue = config.data?.forwarderAddress;
    const forwarder = forwarderValue ? getAddress(forwarderValue) : undefined;
    if (!forwarder) throw new Error("The gas sponsor is not configured.");
    const sponsored = await chain.readContract({ address: to, abi: forwarderTargetAbi,
      functionName: "isTrustedForwarder", args: [forwarder] });
    if (!sponsored) throw new Error("This contract does not trust the gas sponsor.");
    if (!client) throw new Error("The sponsor service is unavailable.");

    const from = getAddress(account);
    const nonce = await chain.readContract({ address: forwarder, abi: accordForwarderAbi,
      functionName: "nonces", args: [from] });
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const message = { from, to, value: BigInt(0), gas, nonce, deadline, data };
    const signature = await signTypedDataAsync({ account: from,
      domain: { name: "AccordForwarder", version: "1", chainId: SEPOLIA_CHAIN_ID, verifyingContract: forwarder },
      types: forwardRequestTypes, primaryType: "ForwardRequest", message,
    });
    const result = await client.relay({ from, to, value: "0", gas: gas.toString(), nonce: nonce.toString(),
      deadline: String(deadline), data, signature });
    return result.transactionHash as Hex;
  }

  return { send };
}
