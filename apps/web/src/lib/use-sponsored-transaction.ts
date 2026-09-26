"use client";

import { accordForwarderAbi, forwardBatchTypes, forwardRequestTypes } from "@accord/chain";
import { encodeFunctionData, erc20Abi, getAddress, parseAbi, type Address, type Hex } from "viem";
import { usePublicClient, useSignTypedData } from "wagmi";
import { SEPOLIA_CHAIN_ID, useAccord } from "./accord";

const targetAbi = parseAbi(["function trustedForwarder() view returns (address)"]);
export type SponsoredCall = { to: Address; data: Hex; gas?: bigint };
type Progress = (detail: string) => void;

/** One signature and one atomic transaction on new Spaces; older forwarders retain atomic execution. */
export function useSponsoredTransaction() {
  const { account, auth, client, config } = useAccord();
  const chain = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const { signTypedDataAsync } = useSignTypedData();

  async function sendBatch(calls: readonly SponsoredCall[], progress?: Progress): Promise<Hex> {
    if (!account || !auth.signedIn || !chain || !client) throw new Error("Sign in with your wallet first.");
    if (!calls.length || calls.length > 8) throw new Error("Choose between one and eight transactions.");
    const from = getAddress(account);
    const forwarders = await Promise.all(calls.map(call => chain.readContract({ address: call.to, abi: targetAbi,
      functionName: "trustedForwarder" })));
    const forwarder = getAddress(forwarders[0]);
    if (forwarders.some(address => address.toLowerCase() !== forwarder.toLowerCase())) throw new Error("These contracts use different gas sponsors.");
    const nonce = await chain.readContract({ address: forwarder, abi: accordForwarderAbi, functionName: "nonces", args: [from] });
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const domain = { name: "AccordForwarder", version: "1", chainId: SEPOLIA_CHAIN_ID, verifyingContract: forwarder } as const;
    const prepared = calls.map(call => ({ ...call, gas: call.gas ?? BigInt(1_500_000) }));
    if (prepared.length > 1 && config.data?.namedSpaces && forwarder.toLowerCase() === config.data.forwarderAddress?.toLowerCase()) {
      progress?.("Confirm once in your wallet");
      const signature = await signTypedDataAsync({ account: from, domain, types: forwardBatchTypes,
        primaryType: "ForwardBatch", message: { from, calls: prepared, nonce, deadline } });
      progress?.("Submitting all steps together");
      const result = await client.executeBatch({ forwarder, from, nonce: nonce.toString(), deadline: String(deadline), signature,
        calls: prepared.map(call => ({ ...call, gas: call.gas.toString() })) });
      return result.transactionHash as Hex;
    }
    // Existing immutable forwarders need one signature per request. Collect them
    // before submitting anything, then execute the sequence atomically in one block.
    const requests = [];
    for (const [index, call] of prepared.entries()) {
      progress?.(prepared.length === 1 ? "Confirm in your wallet" : `Confirm in your wallet (${index + 1} of ${prepared.length})`);
      const message = { ...call, from, value: BigInt(0), nonce: nonce + BigInt(index), deadline };
      const signature = await signTypedDataAsync({ account: from, domain, types: forwardRequestTypes, primaryType: "ForwardRequest", message });
      requests.push({ ...call, forwarder, from, value: "0", gas: call.gas.toString(), nonce: message.nonce.toString(), deadline: String(deadline), signature });
    }
    progress?.("Submitting transaction");
    const result = requests.length === 1 ? await client.relay(requests[0]) : await client.relayBatch(requests);
    return result.transactionHash as Hex;
  }

  function send(to: Address, data: Hex, gas = BigInt(1_500_000)) {
    return sendBatch([{ to, data, gas }]);
  }

  async function sendWithApproval(envelope: { tokenAddress: string; spaceAddress: string; approvalAmount: string; calldata: string; preCalls?: readonly { to: string; data: string }[] }, progress?: Progress) {
    if (!chain || !account) throw new Error("Sign in with your wallet first.");
    const to = getAddress(envelope.spaceAddress), token = getAddress(envelope.tokenAddress);
    const amount = BigInt(envelope.approvalAmount);
    const calls: SponsoredCall[] = envelope.preCalls?.map(call => ({ to: getAddress(call.to), data: call.data as Hex })) ?? [];
    if (amount > BigInt(0)) {
      progress?.("Checking token approval");
      const allowance = await chain.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [getAddress(account), to] });
      if (allowance < amount) calls.push({ to: token, gas: BigInt(150_000),
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [to, amount] }) });
    }
    calls.push({ to, data: envelope.calldata as Hex });
    return sendBatch(calls, progress);
  }

  return { send, sendBatch, sendWithApproval };
}
