import { accordChain, accordForwarderAbi, PermitAction, spaceAccountAbi, type SpacePermit } from "@accord/chain";
import { createAccordClient, paymentDecision, type PermitRequest } from "@accord/sdk";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";
const draftId = process.env.ACCORD_DRAFT_ID;
const allocationId = process.env.ACCORD_ALLOCATION_ID;
const researchTask = process.env.ACCORD_AGENT_TASK === "research";
const amount = process.env.ACCORD_PAYMENT_AMOUNT;
const recipient = process.env.ACCORD_PAYMENT_RECIPIENT as `0x${string}` | undefined;
const requestKey = process.env.ACCORD_REQUEST_KEY;
const privateKey = process.env.ACCORD_AGENT_PRIVATE_KEY as Hex | undefined;
const rpcUrl = process.env.ACCORD_SEPOLIA_RPC_URL;

if (!draftId || !allocationId || (!researchTask && (!amount || !recipient || !requestKey)) || !privateKey || !rpcUrl) {
  console.log("Payment authorization was not sent.");
  console.log("Set ACCORD_DRAFT_ID, ACCORD_ALLOCATION_ID, ACCORD_PAYMENT_AMOUNT,");
  console.log("ACCORD_PAYMENT_RECIPIENT, ACCORD_REQUEST_KEY, ACCORD_AGENT_PRIVATE_KEY,");
  console.log("and ACCORD_SEPOLIA_RPC_URL to use an activated Space against API_URL.");
} else {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("ACCORD_AGENT_PRIVATE_KEY must be a 32-byte hex private key");
  }

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: accordChain, transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  if (chainId !== accordChain.id) {
    throw new Error(`Refusing to submit on chain ${chainId}; expected Sepolia ${accordChain.id}`);
  }

  const publicApi = await createAccordClient(apiUrl);
  const challenge = await publicApi.createChallenge(account.address);
  const challengeSignature = await account.signMessage({ message: challenge.message });
  const session = await publicApi.verifyChallenge({
    id: challenge.id,
    address: account.address,
    signature: challengeSignature,
    client: "agent",
  });
  if (!session.token) throw new Error("Agent authentication did not return a bearer token");

  const client = await createAccordClient(apiUrl, { bearerToken: session.token });
  // Resume delivery with public references instead of paying again after an interrupted run.
  if (researchTask && process.env.ACCORD_RESEARCH_QUOTE_ID && process.env.ACCORD_PAYMENT_TX_HASH) {
    console.log(JSON.stringify(await client.researchRedeem({ quoteId: process.env.ACCORD_RESEARCH_QUOTE_ID,
      transactionHash: process.env.ACCORD_PAYMENT_TX_HASH }), null, 2));
    process.exit(0);
  }
  const quote = researchTask ? await client.researchQuote({ draftId, allocationId }) : undefined;
  if (quote) console.log(JSON.stringify({ step: "quote", quote }));
  const request = { draftId, allocationId, amount: quote?.amount ?? amount!,
    recipient: getAddress(quote?.recipient ?? recipient!), requestKey: quote?.id ?? requestKey! } satisfies PermitRequest;
  const authorization = await client.authorizePayment(request).catch((error: unknown) => {
    const decision = paymentDecision(error);
    if (decision) console.log(JSON.stringify({ step: "decision", decision }));
    throw new Error(decision?.reason ?? "Payment authorization failed; no transaction submitted.");
  });
  console.log(JSON.stringify({ step: "decision", decision: authorization.decision }));
  if (authorization.riskVerdict !== "allow" || !authorization.signature) {
    throw new Error("Payment was not authorized with an allow verdict and signature");
  }
  if (getAddress(authorization.permit.actor) !== account.address) {
    throw new Error("Authorized permit actor does not match the configured agent key");
  }
  if (authorization.permit.action !== PermitAction.Pay || authorization.permit.allocationId !== allocationId ||
    authorization.permit.amount !== request.amount || getAddress(authorization.permit.recipient) !== request.recipient ||
    authorization.permit.requestId !== keccak256(toBytes(request.requestKey)) ||
    (quote && getAddress(authorization.spaceAddress) !== getAddress(quote.spaceAddress))) {
    throw new Error("Authorized permit does not match the exact requested purchase");
  }

  const permit: SpacePermit = {
    actor: getAddress(authorization.permit.actor),
    action: authorization.permit.action,
    allocationId: BigInt(authorization.permit.allocationId),
    recipient: getAddress(authorization.permit.recipient),
    amount: BigInt(authorization.permit.amount),
    requestId: authorization.permit.requestId as Hex,
    nonce: BigInt(authorization.permit.nonce),
    expiry: BigInt(authorization.permit.expiry),
    policyVersion: BigInt(authorization.permit.policyVersion),
    detailsHash: authorization.permit.detailsHash as Hex,
  };

  const space = getAddress(authorization.spaceAddress);
  const data = encodeFunctionData({ abi: spaceAccountAbi, functionName: "pay",
    args: [permit.allocationId, permit.recipient, permit.amount, permit, authorization.signature as Hex] });
  const config = await client.config();
  if (!config.forwarderAddress || !config.demoTokenAddress) throw new Error("The tUSDC sponsor is not configured");
  const forwarder = getAddress(config.forwarderAddress);
  const sponsored = await publicClient.readContract({ address: space,
    abi: parseAbi(["function isTrustedForwarder(address) view returns (bool)"]),
    functionName: "isTrustedForwarder", args: [forwarder] });
  if (!sponsored) throw new Error("This Space does not support sponsored payments");
  const spaceToken = await publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "token" });
  if (spaceToken.toLowerCase() !== config.demoTokenAddress.toLowerCase()) throw new Error("Only tUSDC Spaces are supported");
  const nonce = await publicClient.readContract({ address: forwarder, abi: accordForwarderAbi,
    functionName: "nonces", args: [account.address] });
  const gas = BigInt(1_500_000);
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const signature = await account.signTypedData({
    domain: { name: "AccordForwarder", version: "1", chainId: accordChain.id, verifyingContract: forwarder },
    types: { ForwardRequest: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ] }, primaryType: "ForwardRequest",
    message: { from: account.address, to: space, value: BigInt(0), gas, nonce, deadline, data },
  });
  const transactionHash = (await client.relay({ from: account.address, to: space, value: "0",
    gas: gas.toString(), nonce: nonce.toString(), deadline: String(deadline), data, signature })).transactionHash as Hex;
  // Save these public references to resume delivery without issuing another purchase.
  console.log(JSON.stringify({ step: "submitted", quoteId: quote?.id, transactionHash }));
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error("Payment reverted; the resource was not released");
  console.log(JSON.stringify({ transactionHash, status: receipt.status }, null, 2));
  if (quote) console.log(JSON.stringify({ step: "delivered", report: await client.researchRedeem({ quoteId: quote.id, transactionHash }) }, null, 2));
}
