"use client";

import { spaceAccountAbi, spaceFactoryAbi } from "@accord/chain";
import { paymentDecision, type AccordClient, type Decision } from "@accord/sdk";
import { WorldSession } from "@/components/world-session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, CircleDollarSign, Fingerprint, Rocket, RotateCcw, UserRound } from "lucide-react";
import { useState } from "react";
import { useSpaceTerms } from "@/lib/use-space-terms";
import { SpaceWorkspace } from "./space-workspace";
import { AllocationField } from "./allocation-field";
import { Modal } from "./ui/modal";
import { WorldIdentity } from "./world-identity";
import { getAddress, isAddress, parseUnits, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { PaymentDecision } from "./payment-decision";
import { ResearchPurchase } from "./research-purchase";
import { SpaceActivation } from "./space-activation";
import { ShareSpace } from "./share-space";
import { BeneficiaryPicker, type BeneficiarySelection } from "./beneficiary-picker";
import { AllocationTiming, useClaimAvailability } from "./allocation-timing";
import type { AllocationAction } from "./space-terms";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { activationHash, activationStorageKey, readActivation, saveActivation } from "@/lib/activation-storage";
import "./space-console.css";
import "./space-workspace.css";

type SpaceDraft = Awaited<ReturnType<AccordClient["listSpaces"]>>["spaces"][number];
type ClaimIntent = Awaited<ReturnType<AccordClient["prepareClaim"]>>;
type ClaimChallenge = Awaited<ReturnType<AccordClient["worldChallenge"]>>;

type SpaceConsoleProps = {
  account: Address;
  draft: SpaceDraft;
  client: AccordClient;
  onDraftUpdated?: (draft: SpaceDraft) => void;
};

type ClaimFlow = { intent: ClaimIntent; challenge: ClaimChallenge };
type BusyAction = "activate" | "allocation" | "mandate" | "revoke" | "recover" | "claim" | "payment" | null;
class ActivationReverted extends Error {}

const SEPOLIA_CHAIN_ID = 11_155_111;
const erc20ApproveAbi = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const;
const erc20DecimalsAbi = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }] as const;
const erc20SymbolAbi = [{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }] as const;

function value(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function asAddress(input: string, label: string): Address {
  if (!isAddress(input)) throw new Error(`${label} must be a valid Ethereum address.`);
  return getAddress(input);
}

function positiveInteger(input: string, label: string): string {
  if (!/^[1-9][0-9]*$/.test(input)) throw new Error(`${label} must be a positive whole number.`);
  return input;
}

function tokenAmount(input: string, label: string, decimals: number | undefined): string {
  if (decimals === undefined) throw new Error("Token decimals are still loading.");
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(input)) throw new Error(`${label} must be a positive token amount.`);
  let amount: bigint;
  try { amount = parseUnits(input, decimals); }
  catch { throw new Error(`${label} has too many decimal places for this token.`); }
  if (amount <= BigInt(0)) throw new Error(`${label} must be greater than zero.`);
  return amount.toString();
}

function permitFrom(intent: ClaimIntent) {
  return {
    actor: getAddress(intent.permit.actor),
    action: intent.permit.action,
    allocationId: BigInt(intent.permit.allocationId),
    recipient: getAddress(intent.permit.recipient),
    amount: BigInt(intent.permit.amount),
    requestId: intent.permit.requestId as Hex,
    nonce: BigInt(intent.permit.nonce),
    expiry: BigInt(intent.permit.expiry),
    policyVersion: BigInt(intent.permit.policyVersion),
    detailsHash: intent.permit.detailsHash as Hex,
  };
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function SpaceConsole({ account, draft, client, onDraftUpdated }: SpaceConsoleProps) {
  const queryClient = useQueryClient();
  const connection = useAccount();
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const [currentDraft, setCurrentDraft] = useState(draft);
  const [action, setAction] = useState<AllocationAction | null>(null);
  const [selectedAllocation, setSelectedAllocation] = useState("");
  const [recoverId, setRecoverId] = useState<string | null>(null);

  function navigateAction(next: AllocationAction | null, id = "") {
    setAction(next); setSelectedAllocation(id); setNotice(null);
    setDecision(undefined); setPaymentSettled(false);
    setClaimAllocationId(next === "claim" ? id : "");
    if (action === "allocate" && next !== "allocate") {
      setBeneficiarySelection(null);
      setBeneficiaryRevision((revision) => revision + 1);
    }
  }

  const [busy, setBusy] = useState<BusyAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision>();
  const [paymentSettled, setPaymentSettled] = useState(false);
  const [beneficiarySelection, setBeneficiarySelection] = useState<BeneficiarySelection | null>(null);
  const [beneficiaryRevision, setBeneficiaryRevision] = useState(0);
  const [allocationKind, setAllocationKind] = useState<"person" | "agent">(
    draft.templateId === "research-budget" ? "agent" : "person",
  );
  const [allocationPeriod, setAllocationPeriod] = useState<0 | 1 | 2 | 3>(
    draft.templateId === "research-budget" ? 0 : 2,
  );
  const [claimFlow, setClaimFlow] = useState<ClaimFlow | null>(null);
  const [worldOpen, setWorldOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [claimAllocationId, setClaimAllocationId] = useState("");
  const claimAvailability = useClaimAvailability(currentDraft.spaceAddress, claimAllocationId);
  const scheduleSupport = useQuery({
    queryKey: ["schedule-support", currentDraft.spaceAddress],
    enabled: !!currentDraft.spaceAddress && !!publicClient,
    retry: false, staleTime: Infinity,
    queryFn: () => publicClient!.readContract({ address: getAddress(currentDraft.spaceAddress!), abi: spaceAccountAbi, functionName: "allocationScheduleVersion" }),
  });
  const config = useQuery({
    queryKey: ["accord-config"],
    queryFn: () => client.config(),
    staleTime: 5 * 60_000,
  });

  const isOwner = currentDraft.owner.toLowerCase() === account.toLowerCase();
  const isActive = Boolean(currentDraft.spaceAddress && currentDraft.tokenAddress && currentDraft.activatedAt);
  const terms = useSpaceTerms(isActive ? currentDraft.spaceAddress : undefined);
  const selectedTerms = terms.data?.allocations.find(({ id }) => id.toString() === selectedAllocation);
  const activationKey = activationStorageKey(account, currentDraft.id);
  const pendingActivation = useQuery({
    queryKey: ["pending-activation", activationKey],
    queryFn: () => { try { return readActivation(window.localStorage, activationKey); } catch { return null; } },
    staleTime: Infinity, retry: false,
  });
  const [activationStorageWarning, setActivationStorageWarning] = useState(false);
  const worldStatus = useQuery({
    queryKey: ["world-status", account],
    queryFn: () => client.worldStatus(),
    enabled: isActive,
    retry: false,
  });
  const tokenDecimals = useQuery({
    queryKey: ["token-decimals", currentDraft.tokenAddress],
    queryFn: async () => Number(await publicClient!.readContract({ address: getAddress(currentDraft.tokenAddress!), abi: erc20DecimalsAbi, functionName: "decimals" })),
    enabled: isActive && !!publicClient,
    staleTime: Infinity,
  });
  const tokenSymbol = useQuery({
    queryKey: ["token-symbol", currentDraft.tokenAddress],
    queryFn: async () => publicClient!.readContract({ address: getAddress(currentDraft.tokenAddress!),
      abi: erc20SymbolAbi, functionName: "symbol" }),
    enabled: isActive && !!publicClient,
    staleTime: Infinity,
    retry: false,
  });
  const assetLabel = tokenSymbol.data || "token units";

  function requireWallet() {
    if (!publicClient || connection.chainId !== SEPOLIA_CHAIN_ID) {
      throw new Error("Switch the connected wallet to Ethereum Sepolia.");
    }
    if (!connection.address || connection.address.toLowerCase() !== account.toLowerCase()) {
      throw new Error("The connected wallet no longer matches the signed-in account.");
    }
    return publicClient;
  }

  async function refreshSpace() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["space-terms", currentDraft.spaceAddress] }),
      queryClient.invalidateQueries({ queryKey: ["space-activity", currentDraft.spaceAddress] }),
      queryClient.invalidateQueries({ queryKey: ["allocation-names", currentDraft.spaceAddress] }),
      queryClient.invalidateQueries({ queryKey: ["claim-availability", currentDraft.spaceAddress] }),
    ]);
  }

  async function waitForSuccess(hash: Hex) {
    const receipt = await requireWallet().waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The wallet transaction reverted.");
    await refreshSpace();
    return receipt;
  }

  async function sendPermitTransaction(requestId: Hex, submit: () => Promise<Hex>): Promise<Hex | null> {
    const chain = requireWallet();
    const spaceAddress = getAddress(currentDraft.spaceAddress!);
    let finished = false;
    const onchain = (async () => {
      for (let attempt = 0; attempt < 90 && !finished; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (finished) break;
        try {
          const consumed = await chain.readContract({ address: spaceAddress, abi: spaceAccountAbi,
            functionName: "consumedRequests", args: [requestId] });
          if (consumed) return { kind: "confirmed" as const };
        } catch { /* A transient read failure should not discard the wallet request. */ }
      }
      throw new Error("Wallet response timed out. Check Space activity before retrying; the transaction may have landed.");
    })();
    try {
      const result = await Promise.race([
        submit().then((hash) => ({ kind: "hash" as const, hash })),
        onchain,
      ]);
      if (result.kind === "hash") {
        await waitForSuccess(result.hash);
        return result.hash;
      }
      await refreshSpace();
      return null;
    } finally {
      finished = true;
    }
  }

  function confirmedNotice(action: string, hash: Hex | null) {
    return hash ? `${action} in transaction ${shortAddress(hash)}.`
      : `${action} onchain. The wallet response was delayed; see Space activity for the receipt.`;
  }

  function reportError(error: unknown, fallback: string) {
    const detailed = paymentDecision(error);
    if (detailed) { setNotice(detailed.reason); return; }
    const message = error instanceof Error ? error.message : "";
    const shortMessage = error && typeof error === "object" && "shortMessage" in error &&
      typeof error.shortMessage === "string" ? error.shortMessage : "";
    // Effect's HTTP errors carry a JSON tag; give the user a useful next step.
    try {
      const apiError = JSON.parse(message) as { _tag?: string };
      if (apiError._tag === "Forbidden") {
        setNotice(`${fallback} Check the allocation's access, limits, and current permissions.`);
        return;
      }
      if (apiError._tag === "ServiceUnavailable") {
        setNotice("A required verification service is unavailable. No transaction was submitted. Try again later.");
        return;
      }
      if (apiError._tag) { setNotice(fallback); return; }
    } catch { /* A normal wallet or form-validation message. */ }
    // Wallet libraries append full calldata and request arguments to errors. Keep
    // the actionable reason in the UI without exposing an unreadable payload.
    setNotice(shortMessage || message.split(/\n\s*(?:Request Arguments|Details):/)[0] || fallback);
  }

  function rememberActivation(hash: Hex | null) {
    queryClient.setQueryData(["pending-activation", activationKey], hash);
    try { setActivationStorageWarning(!saveActivation(window.localStorage, activationKey, hash)); }
    catch { setActivationStorageWarning(true); }
  }

  async function finishActivation(hash: Hex) {
    setNotice("Waiting for the activation transaction to confirm…");
    const receipt = await requireWallet().waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") {
      rememberActivation(null);
      throw new ActivationReverted("The activation transaction reverted. You can try activating again.");
    }
    setNotice("Transaction confirmed. Saving your Space…");
    const activated = await client.activateSpace({ draftId: currentDraft.id, deploymentTx: hash });
    rememberActivation(null);
    setCurrentDraft(activated);
    onDraftUpdated?.(activated);
    void queryClient.invalidateQueries({ queryKey: ["spaces"] });
    setNotice("Space is active. Create your first allocation to reserve funds for a person or agent.");
  }

  function activationError(error: unknown) {
    const tag = error && typeof error === "object" && "_tag" in error ? error._tag : undefined;
    if (error instanceof ActivationReverted) {
      setNotice(error.message);
    } else if (tag === "Unauthorized") {
      setNotice("Sign in again, then finish activation using the saved transaction. No new network fee is needed.");
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    } else if (tag === "BadRequest" || tag === "Forbidden") {
      setNotice("This transaction could not be linked to the draft. Check that it created a Space for this wallet using Accord’s factory, then retry saving it.");
    } else {
      setNotice("The transaction was submitted, but confirming and saving this Space did not finish. Check its status, then use Finish activation to retry without a new transaction.");
    }
  }

  async function retryActivation(hash: Hex) {
    if (!isOwner || isActive || busy !== null) return;
    setBusy("activate");
    rememberActivation(hash);
    try { await finishActivation(hash); }
    catch (error) { activationError(error); }
    finally { setBusy(null); }
  }

  async function activate(token: Address) {
    if (!isOwner || isActive || busy !== null || pendingActivation.isPending || pendingActivation.data) return;
    setBusy("activate");
    setNotice(null);
    let submitted = false;
    try {
      requireWallet();
      const deployment = config.data;
      if (!deployment?.configured || !deployment.factoryAddress || !deployment.adapterAddress ||
        !deployment.authorizerAddress) throw new Error("Space activation is temporarily unavailable. Please try again later.");
      const hash = await writeContractAsync({
        address: getAddress(deployment.factoryAddress),
        abi: spaceFactoryAbi,
        functionName: "createSpace",
        args: [getAddress(deployment.authorizerAddress), token, getAddress(deployment.adapterAddress)],
        chainId: SEPOLIA_CHAIN_ID,
      });
      submitted = true;
      rememberActivation(hash);
      await finishActivation(hash);
    } catch (error) {
      if (submitted) activationError(error);
      else reportError(error, "Space activation did not complete.");
    } finally {
      setBusy(null);
    }
  }

  async function createAllocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isOwner || !isActive) return;
    const formElement = event.currentTarget;
    setBusy("allocation");
    setNotice(null);
    try {
      requireWallet();
      const form = new FormData(formElement);
      const amount = tokenAmount(value(form, "amount"), "Total amount", tokenDecimals.data);
      const period = allocationPeriod;
      const periodCap = period === 0 ? amount : tokenAmount(value(form, "periodCap"), "Period cap", tokenDecimals.data);
      if (allocationKind === "person" && !beneficiarySelection) throw new Error("Resolve and confirm the beneficiary wallet first.");
      const beneficiary = allocationKind === "agent" ? zeroAddress : beneficiarySelection!.address;
      const envelope = await client.createAllocation({
        draftId: currentDraft.id,
        requestKey: crypto.randomUUID(),
        beneficiary,
        ...(allocationKind === "person" && beneficiarySelection?.ensName ? { beneficiaryEnsName: beneficiarySelection.ensName } : {}),
        amount,
        periodCap,
        period,
        ...(period === 3 ? { schedule: { intervalSeconds: 60, durationSeconds: 300 } } : {}),
      });
      setNotice("Step 1 of 2: approve token access in your wallet.");
      const approvalHash = await writeContractAsync({
        address: getAddress(envelope.tokenAddress),
        abi: erc20ApproveAbi,
        functionName: "approve",
        args: [getAddress(envelope.spaceAddress), BigInt(envelope.approvalAmount)],
        chainId: SEPOLIA_CHAIN_ID,
      });
      await waitForSuccess(approvalHash);
      setNotice("Step 2 of 2: confirm funding the allocation in your wallet.");
      const hash = await sendPermitTransaction(envelope.permit.requestId as Hex, () => sendTransactionAsync({
        to: getAddress(envelope.spaceAddress),
        data: envelope.calldata as Hex,
        chainId: SEPOLIA_CHAIN_ID,
      }));
      setNotice(confirmedNotice(`Allocation ${envelope.permit.allocationId} created`, hash));
      formElement.reset();
      setBeneficiarySelection(null);
      setBeneficiaryRevision((revision) => revision + 1);
      if (allocationKind === "agent") {
        setSelectedAllocation(envelope.permit.allocationId.toString());
        setAction("mandate");
      } else { setAction(null); }
    } catch (error) {
      if (error && typeof error === "object" && "_tag" in error && error._tag === "Conflict") {
        setBeneficiarySelection(null);
        setBeneficiaryRevision((revision) => revision + 1);
        setNotice("The ENS payment address changed. Resolve the name and confirm its wallet again before creating the allocation.");
        return;
      }
      reportError(error, "The allocation could not be created.");
    } finally {
      setBusy(null);
    }
  }

  async function setMandate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isOwner || !isActive) return;
    const formElement = event.currentTarget;
    setBusy("mandate");
    setNotice(null);
    try {
      requireWallet();
      const registry = config.data?.ensRegistryAddress;
      if (!registry) throw new Error("The trusted ENS registry is not configured.");
      const form = new FormData(formElement);
      const agent = asAddress(value(form, "agent"), "Agent");
      const name = await client.resolveEnsName(value(form, "ensName"));
      if (!name.active || name.owner.toLowerCase() !== agent.toLowerCase() ||
        name.registry.toLowerCase() !== registry.toLowerCase()) {
        throw new Error("That ENSv2 name is not actively registered to the agent wallet.");
      }
      const expiry = Date.parse(value(form, "expiry"));
      if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry >= Number(name.expiry) * 1000) {
        throw new Error("Choose an expiry before the ENS name expires.");
      }
      const envelope = await client.setMandate({
        draftId: currentDraft.id,
        requestKey: crypto.randomUUID(),
        allocationId: positiveInteger(value(form, "allocationId"), "Allocation ID"),
        agent,
        registry: getAddress(registry),
        nameId: name.nameId,
        expectedResource: name.resource,
        dailyCap: tokenAmount(value(form, "dailyCap"), "Daily cap", tokenDecimals.data),
        maxPerPayment: tokenAmount(value(form, "maxPerPayment"), "Maximum payment", tokenDecimals.data),
        expiry: String(Math.floor(expiry / 1000)),
      });
      const hash = await sendPermitTransaction(envelope.permit.requestId as Hex, () => sendTransactionAsync({
        to: getAddress(envelope.spaceAddress),
        data: envelope.calldata as Hex,
        chainId: SEPOLIA_CHAIN_ID,
      }));
      setNotice(confirmedNotice(`Mandate for ${name.name} attached to allocation ${envelope.permit.allocationId}`, hash));
      formElement.reset();
    } catch (error) {
      reportError(error, "The mandate could not be set.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeMandate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isOwner || !isActive) return;
    setBusy("revoke"); setNotice(null);
    try {
      requireWallet();
      const envelope = await client.revokeMandate({
        draftId: currentDraft.id,
        requestKey: crypto.randomUUID(),
        allocationId: positiveInteger(value(new FormData(event.currentTarget), "allocationId"), "Allocation ID"),
      });
      const hash = await sendPermitTransaction(envelope.permit.requestId as Hex, () => sendTransactionAsync({ to: getAddress(envelope.spaceAddress), data: envelope.calldata as Hex, chainId: SEPOLIA_CHAIN_ID }));
      setNotice(confirmedNotice(`Mandate ${envelope.permit.allocationId} revoked`, hash));
    } catch (error) { reportError(error, "The mandate could not be revoked."); }
    finally { setBusy(null); }
  }

  async function recoverAllocation(allocationId: string) {
    if (!isOwner || !isActive) return;
    setBusy("recover"); setNotice(null);
    try {
      requireWallet();
      const envelope = await client.recoverAllocation({
        draftId: currentDraft.id,
        requestKey: crypto.randomUUID(),
        allocationId: positiveInteger(allocationId, "Allocation ID"),
      });
      const hash = await sendPermitTransaction(envelope.permit.requestId as Hex, () => sendTransactionAsync({ to: getAddress(envelope.spaceAddress), data: envelope.calldata as Hex, chainId: SEPOLIA_CHAIN_ID }));
      setNotice(confirmedNotice(`Allocation ${envelope.permit.allocationId} closed and unspent tokens returned`, hash));
    } catch (error) { reportError(error, "The allocation could not be recovered."); }
    finally { setBusy(null); setRecoverId(null); }
  }

  async function beginClaim(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isActive) return;
    setBusy("claim");
    setNotice(null);
    try {
      requireWallet();
      const form = new FormData(event.currentTarget);
      const intent = await client.prepareClaim({
        draftId: currentDraft.id,
        allocationId: positiveInteger(value(form, "allocationId"), "Allocation ID"),
        amount: tokenAmount(value(form, "amount"), "Claim amount", tokenDecimals.data),
        requestKey: crypto.randomUUID(),
      });
      const challenge = await client.worldChallenge("claim", intent.id);
      if (!challenge.signal) throw new Error("World ID did not return the claim-bound signal.");
      setClaimFlow({ intent, challenge });
      setWorldOpen(true);
    } catch (error) {
      reportError(error, "The claim verification could not start.");
    } finally {
      setBusy(null);
    }
  }

  async function completeClaim() {
    if (!claimFlow) return;
    setBusy("claim");
    try {
      const signed = await client.signClaim(claimFlow.intent.id);
      if (!signed.signature) throw new Error("The claim could not be authorized. Try a fresh verification.");
      const hash = await sendPermitTransaction(signed.permit.requestId as Hex, () => writeContractAsync({
        address: getAddress(signed.spaceAddress),
        abi: spaceAccountAbi,
        functionName: "claim",
        args: [BigInt(signed.permit.allocationId), BigInt(signed.permit.amount), permitFrom(signed), signed.signature as Hex],
        chainId: SEPOLIA_CHAIN_ID,
      }));
      setClaimFlow(null); setWorldOpen(false); setAction(null);
      setNotice(confirmedNotice("Claim confirmed", hash));
    } catch (error) {
      reportError(error, "The verified claim could not be submitted.");
    } finally {
      setBusy(null);
    }
  }

  async function pay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isActive) return;
    const formElement = event.currentTarget;
    setBusy("payment");
    setNotice(null);
    setDecision(undefined); setPaymentSettled(false);
    try {
      requireWallet();
      const form = new FormData(formElement);
      const recipient = asAddress(value(form, "recipient"), "Recipient");
      const authorized = await client.authorizePayment({
        draftId: currentDraft.id,
        allocationId: positiveInteger(value(form, "allocationId"), "Allocation ID"),
        amount: tokenAmount(value(form, "amount"), "Payment amount", tokenDecimals.data),
        recipient,
        requestKey: crypto.randomUUID(),
      });
      if (!authorized.signature || authorized.riskVerdict !== "allow") {
        throw new Error("This payment could not be authorized. Please try again.");
      }
      setDecision(authorized.decision);
      const hash = await sendPermitTransaction(authorized.permit.requestId as Hex, () => writeContractAsync({
        address: getAddress(authorized.spaceAddress),
        abi: spaceAccountAbi,
        functionName: "pay",
        args: [BigInt(authorized.permit.allocationId), recipient, BigInt(authorized.permit.amount),
          permitFrom(authorized), authorized.signature as Hex],
        chainId: SEPOLIA_CHAIN_ID,
      }));
      setPaymentSettled(true);
      setNotice(confirmedNotice("Payment confirmed", hash));
      formElement.reset();
    } catch (error) {
      const declined = paymentDecision(error);
      setDecision(declined);
      if (!declined) reportError(error, "The payment was not authorized or submitted.");
    } finally {
      setBusy(null);
    }
  }

  return <section className="space-console" aria-labelledby={`space-${currentDraft.id}`}>
    <header className="space-console__header">
      <div>
        <span className="space-console__kicker">{isOwner ? "Your Space" : "Shared with you"} <span>Sepolia testnet</span></span>
        <h1 id={`space-${currentDraft.id}`}>{currentDraft.name}</h1>
        <p>{isOwner ? "A shared purpose. Clear permissions." : "See what’s assigned to you and put your allocation to use."}</p>
        {isActive && <p className="space-console__asset">Asset: {assetLabel} · <a href={`https://sepolia.etherscan.io/token/${currentDraft.tokenAddress}`} target="_blank" rel="noreferrer" title={currentDraft.tokenAddress!}>{shortAddress(currentDraft.tokenAddress!)}</a></p>}
      </div>
      <span className={`space-console__state ${isActive ? "is-active" : ""}`}>
        {isActive ? <CheckCircle2 size={15} /> : <Rocket size={15} />}
        {isActive ? "Active" : "Draft"}
      </span>
    </header>

    {isActive ? <ShareSpace address={currentDraft.spaceAddress!} /> : null}
    {notice ? <p className="space-console__notice" role="status">{notice}</p> : null}
    {isActive && tokenDecimals.isError ? <p className="space-console__notice" role="status">This token does not expose decimals. Its actions need a token with ERC-20 metadata.</p> : null}

    {!isActive ? <div className="space-console__activation">
      <div className="space-console__intro"><Rocket size={22} /><div><strong>{pendingActivation.data ? "Finish setting up your Space" : "Set up your Space"}</strong>{!pendingActivation.data ? <p>Choose the asset this Space will hold and distribute.</p> : null}</div></div>
      {pendingActivation.isPending ? <p className="space-activation__help" role="status">Checking for a previous activation…</p>
        : pendingActivation.data ? <div className="space-activation__recovery">
          <strong>Activation submitted</strong>
          <p>Your transaction is saved. Finish confirming and linking this Space without sending another transaction.</p>
          <a href={`https://sepolia.etherscan.io/tx/${pendingActivation.data}`} target="_blank" rel="noreferrer">View transaction {shortAddress(pendingActivation.data)}</a>
          {activationStorageWarning ? <p>Browser storage is unavailable. Keep the transaction link to recover after a reload.</p> : null}
          <Button type="button" disabled={!isOwner || busy !== null} onClick={() => void retryActivation(pendingActivation.data!)}>{busy === "activate" ? "Finishing activation…" : "Finish activation"}</Button>
        </div> : config.isPending ? <p className="space-activation__help" role="status">Loading asset setup…</p>
        : config.isError || !config.data?.configured || !config.data.factoryAddress || !config.data.adapterAddress || !config.data.authorizerAddress
          ? <div className="space-activation__status is-error" role="status">Asset setup is unavailable. Try loading it again.
            <Button type="button" variant="outline" size="sm" disabled={config.isFetching} onClick={() => void config.refetch()}>Retry setup</Button>
          </div> : <SpaceActivation demoTokenAddress={config.data.demoTokenAddress}
            disabled={!isOwner || busy !== null} activating={busy === "activate"} onActivate={activate} />}
      {!pendingActivation.isPending && isOwner ? <details className="space-activation__advanced">
        <summary>{pendingActivation.data ? "Use a different transaction hash" : "Already submitted an activation?"}</summary>
        <form className="space-console__form" onSubmit={(event) => {
          event.preventDefault();
          const hash = value(new FormData(event.currentTarget), "activationTx");
          if (!activationHash.test(hash)) { setNotice("Enter the full transaction hash from your wallet’s activity."); return; }
          void retryActivation(hash as Hex);
        }}>
          <Field label="Activation transaction hash"><Input name="activationTx" required placeholder="0x…" disabled={busy !== null} autoComplete="off" spellCheck={false} /></Field>
          <Button type="submit" variant="outline" disabled={busy !== null}>Recover activation</Button>
        </form>
      </details> : null}
      {!isOwner ? <p className="space-console__hint">Only the draft owner can activate this Space.</p> : null}
    </div> : <SpaceWorkspace isOwner={isOwner} account={account} spaceAddress={currentDraft.spaceAddress!}
      client={client} decimals={tokenDecimals.data} symbol={assetLabel} busy={busy !== null || worldOpen}
      action={action} onAction={navigateAction}>
      {isOwner && action === "allocate" ? <div className="space-action-layout">
      {isOwner ? <article className="space-console__card">
        <form onSubmit={createAllocation} className="space-console__form"><fieldset className="space-console__fields" disabled={busy !== null}>
          <Field label="Allocation for"><select value={allocationKind} onChange={(event) => {
            const kind = event.target.value as "person" | "agent";
            setAllocationKind(kind);
            setBeneficiarySelection(null);
            setBeneficiaryRevision((revision) => revision + 1);
            setAllocationPeriod(kind === "agent" ? 0 : 2);
          }}><option value="person">Person · World ID claim</option><option value="agent">Agent · ENSv2 mandate</option></select></Field>
          {allocationKind === "person" ? <BeneficiaryPicker key={beneficiaryRevision} client={client} disabled={busy !== null} onChange={setBeneficiarySelection} /> : null}
          <div className="space-console__row"><Field label={`Total to reserve · ${assetLabel}`}><Input name="amount" inputMode="decimal" required placeholder="100" /></Field>{allocationPeriod !== 0 ? <Field label={`Limit per period · ${assetLabel}`}><Input name="periodCap" inputMode="decimal" required placeholder="10" /></Field> : null}</div>
          <Field label="Limit resets"><select value={allocationPeriod} onChange={(event) => setAllocationPeriod(Number(event.target.value) as 0 | 1 | 2 | 3)}><option value="0">No reset</option><option value="1">Daily</option><option value="2">Monthly</option>{allocationKind === "person" ? <option value="3" disabled={scheduleSupport.data !== BigInt(1)}>Every minute · 5-minute demo</option> : null}</select></Field>
          {allocationPeriod === 3 ? <p className="space-console__hint">Five 60-second windows, starting when funding confirms. The first claim is available immediately; unused allowance does not carry over. Try 50 {assetLabel} total with a 10 {assetLabel} cap. Link World ID before funding so the demo is ready to run.</p> : scheduleSupport.isError && allocationKind === "person" ? <p className="space-console__hint">Minute schedules require a new Space. Existing allocations keep their original terms.</p> : null}
          {allocationPeriod === 0 ? <p className="space-console__hint">No reset lets the allocation spend up to its total. Agent mandates still apply a daily cap.</p> : null}
          <Button type="submit" disabled={busy !== null || tokenDecimals.data === undefined || (allocationKind === "person" && !beneficiarySelection)}>{busy === "allocation" ? "Confirming…" : "Approve & fund allocation"}</Button>
        </fieldset></form>
      </article> : null}

      <aside className="space-action-guide"><h3>What happens next</h3><ol><li><strong>Reserve funds</strong><p>Approve token access, then confirm the allocation. Both steps happen in your wallet.</p></li><li><strong>{allocationKind === "agent" ? "Set a mandate" : "Share your Space"}</strong><p>{allocationKind === "agent" ? "Choose the agent and set its spending limits after funding." : "Send the link to your recipient. Only their assigned wallet can claim."}</p></li><li><strong>{allocationKind === "agent" ? "Let the agent act" : "The recipient claims"}</strong><p>{allocationKind === "agent" ? "Each payment checks the mandate and screens the destination." : "They verify with World ID and receive funds within your limits."}</p></li></ol></aside>
      </div> : null}
      {isOwner && action === "mandate" ? <article className="space-console__card">
        <div className="space-console__card-title"><Bot size={18} /><div><strong>Set agent mandate</strong><span>Bound to current ENSv2 authority</span></div></div>
        <form onSubmit={setMandate} className="space-console__form"><fieldset className="space-console__fields" disabled={busy !== null}>
          <div className="space-console__row"><AllocationField key={`mandate:${selectedAllocation}`} spaceAddress={currentDraft.spaceAddress!} account={account} purpose="mandate" selectedId={selectedAllocation} /><Field label="Agent wallet"><Input name="agent" required placeholder="0x…" /></Field></div>
          <Field label="ENSv2 .eth name"><Input name="ensName" required placeholder="research.eth" /></Field>
          <div className="space-console__row"><Field label={`Daily cap · ${assetLabel}`}><Input name="dailyCap" inputMode="decimal" required /></Field><Field label={`Max payment · ${assetLabel}`}><Input name="maxPerPayment" inputMode="decimal" required /></Field></div>
          <Field label="Mandate expiry"><Input name="expiry" type="datetime-local" required /></Field>
          <Button type="submit" disabled={busy !== null || tokenDecimals.data === undefined}>{busy === "mandate" ? "Confirming…" : "Set mandate"}</Button>
        </fieldset></form>

      </article> : null}

      {isOwner && action === "settings" ? <div className="space-console__grid">
      {isOwner ? <article className="space-console__card">
        <div className="space-console__card-title"><RotateCcw size={18} /><div><strong>Recover allocation</strong><span>Owner action · closes future access</span></div></div>
        <p className="space-console__hint">Return the unspent tokens to your wallet and permanently close this allocation. Claims and agent payments from it will stop.</p>
        <form onSubmit={(event) => { event.preventDefault(); setRecoverId(value(new FormData(event.currentTarget), "allocationId")); }} className="space-console__form">
          <AllocationField key={`recover:${selectedAllocation}`} spaceAddress={currentDraft.spaceAddress!} account={account} purpose="recover" selectedId={selectedAllocation} />
          <Button type="submit" variant="outline" disabled={busy !== null}>{busy === "recover" ? "Recovering…" : "Recover & close"}</Button>
        </form>
      </article> : null}

        {!selectedTerms || selectedTerms.allocation[0] === zeroAddress ? <article className="space-console__card"><div className="space-console__card-title"><Bot size={18} /><div><strong>Revoke agent mandate</strong><span>Stop an agent’s permission to spend</span></div></div>
        <form onSubmit={revokeMandate} className="space-console__form space-console__revoke"><fieldset className="space-console__fields" disabled={busy !== null}>
          <AllocationField key={`revoke:${selectedAllocation}`} spaceAddress={currentDraft.spaceAddress!} account={account} purpose="revoke" selectedId={selectedAllocation} />
          <Button type="submit" variant="outline" disabled={busy !== null}>{busy === "revoke" ? "Revoking…" : "Revoke mandate"}</Button>
        </fieldset></form>        </article> : null}
      </div> : null}
      {action === "claim" ? <div className="space-claim-flow">
        <WorldIdentity address={account} client={client} signedIn />
      <article className="space-console__card">
        <div className="space-console__card-title"><UserRound size={18} /><div><strong>Claim allocation</strong><span>Named beneficiary only · World ID required</span></div></div>
        <p className="space-console__hint">Funds go to your connected wallet, {shortAddress(account)}. {worldStatus.data?.enrolled ? "Each claim needs a fresh World ID check." : <>First <a href="#world-heading">link your World ID session</a> to this wallet, then verify each claim.</>}</p>
        <form onSubmit={beginClaim} className="space-console__form"><fieldset className="space-console__fields" disabled={busy !== null}>
          <div className="space-console__row"><AllocationField key={`claim:${selectedAllocation}`} spaceAddress={currentDraft.spaceAddress!} account={account} purpose="claim" selectedId={selectedAllocation} onChange={setClaimAllocationId} /><Field label={`Amount · ${assetLabel}`}><Input name="amount" inputMode="decimal" required /></Field></div>
          {claimAvailability.data ? <AllocationTiming {...claimAvailability.data} decimals={tokenDecimals.data} symbol={assetLabel} /> : null}
          {claimAvailability.isError ? <p className="space-console__hint" role="status">Could not read this allocation’s current allowance. <Button type="button" variant="ghost" onClick={() => void claimAvailability.refetch()}>Retry availability</Button></p> : null}
          <Button type="submit" disabled={busy !== null || tokenDecimals.data === undefined || !worldStatus.data?.enrolled || claimAvailability.data?.window.available === BigInt(0) || claimAvailability.isError || claimAvailability.isPending}><Fingerprint size={15} /> {busy === "claim" ? "Preparing…" : "Verify & claim"}</Button>
        </fieldset></form>
      </article>
      </div> : null}
      {action === "payments" ? <div>
      <article className="space-console__card space-console__card--payment">
        <div className="space-console__card-title"><CircleDollarSign size={18} /><div><strong>Request payment</strong><span>Mandated agent only · live ENSv2 and risk checks</span></div></div>
        <form onSubmit={pay} className="space-console__form"><fieldset className="space-console__fields" disabled={busy !== null}>
          <div className="space-console__row"><AllocationField key={`payments:${selectedAllocation}`} spaceAddress={currentDraft.spaceAddress!} account={account} purpose="payments" selectedId={selectedAllocation} /><Field label={`Amount · ${assetLabel}`}><Input name="amount" inputMode="decimal" required /></Field></div>
          <Field label="Recipient"><Input name="recipient" required placeholder="0x…" /></Field>
          <Button type="submit" disabled={busy !== null || tokenDecimals.data === undefined}>{busy === "payment" ? "Authorizing…" : "Authorize & pay"}</Button>
        </fieldset></form>
        {decision ? <PaymentDecision decision={decision} settled={paymentSettled} /> : null}
      </article>
        <details className="report-demo" open={reportOpen} onToggle={(event) => setReportOpen(event.currentTarget.open)}><summary>Try a paid research report <span>Example agent purchase</span></summary>{reportOpen ? <ResearchPurchase key={`${currentDraft.id}:${account}`} client={client} draftId={currentDraft.id} decimals={tokenDecimals.data} symbol={assetLabel} account={account} /> : null}</details>
      </div> : null}
    </SpaceWorkspace>}

    <Modal open={recoverId !== null} onOpenChange={(open) => { if (!open) setRecoverId(null); }} busy={busy !== null}
      title={`Close allocation ${recoverId ?? ""}?`} description="Unspent tokens will return to your wallet. This permanently stops claims and payments from this allocation.">
      <div className="modal-actions recovery-confirm"><Button variant="outline" disabled={busy !== null} onClick={() => setRecoverId(null)}>Keep allocation</Button><Button disabled={busy !== null} onClick={() => recoverId && void recoverAllocation(recoverId)}>{busy === "recover" ? "Closing…" : "Confirm & close"}</Button></div>
    </Modal>
    {claimFlow?.challenge.signal ? <WorldSession
      open={worldOpen}
      onOpenChange={setWorldOpen}
      app_id={claimFlow.challenge.appId as `app_${string}`}
      rp_context={claimFlow.challenge.rpContext}
      environment={claimFlow.challenge.environment}
      existing_session_id={claimFlow.challenge.sessionId as `session_${string}` | undefined}
      require_user_presence={claimFlow.challenge.requireUserPresence}
      constraints={{ type: "selfie", signal: claimFlow.challenge.signal }}
      handleVerify={(result) => client.worldVerify(claimFlow.challenge.id, result).then(() => undefined)}
      onSuccess={completeClaim}
      onError={() => {
        setWorldOpen(false);
        setClaimFlow(null);
        setNotice("World ID verification did not complete. Start a fresh claim to retry.");
      }}
    /> : null}
  </section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <Label className="space-console__field"><span>{label}</span>{children}</Label>;
}
