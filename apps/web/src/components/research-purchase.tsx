"use client";

import { PermitAction, spaceAccountAbi } from "@accord/chain";
import { paymentDecision, type AccordClient, type Decision } from "@accord/sdk";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BaseError, UserRejectedRequestError, formatUnits, getAddress, keccak256, toBytes, type Hex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaymentDecision } from "./payment-decision";
import { purchaseStorageKey, readPurchase, savePurchase, transactionHash as validTransactionHash, type SavedPurchase } from "@/lib/purchase-storage";

type Report = Awaited<ReturnType<AccordClient["researchRedeem"]>>;
class PurchaseMessage extends Error {}

export function ResearchPurchase({ client, draftId, decimals, symbol, account }: {
  client: AccordClient; draftId: string; decimals?: number; symbol: string; account: string;
}) {
  const publicClient = usePublicClient({ chainId: 11155111 });
  const connection = useAccount();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const storageKey = purchaseStorageKey(account, draftId);
  const purchaseKey = ["report-purchase", storageKey];
  const saved = useQuery({ queryKey: purchaseKey,
    queryFn: () => { try { return readPurchase(window.localStorage, storageKey, draftId); } catch { return null; } },
    staleTime: Infinity, retry: false });
  const quote = saved.data?.quote;
  const hash = saved.data?.hash;
  const [report, setReport] = useState<Report>();
  const [decision, setDecision] = useState<Decision>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [storageWarning, setStorageWarning] = useState(false);
  const [reverted, setReverted] = useState(false);
  const [stage, setStage] = useState("");
  const units = (amount: string) => decimals === undefined ? `${amount} base units` : `${formatUnits(BigInt(amount), decimals)} ${symbol}`;

  function remember(purchase: SavedPurchase | null) {
    queryClient.setQueryData(purchaseKey, purchase);
    try { setStorageWarning(!savePurchase(window.localStorage, storageKey, purchase)); }
    catch { setStorageWarning(true); }
  }

  async function requestQuote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const allocationId = String(new FormData(event.currentTarget).get("allocationId") ?? "").trim();
    if (!/^[1-9][0-9]*$/.test(allocationId)) { setMessage("Enter an agent allocation ID."); return; }
    setBusy(true); setMessage(undefined); setDecision(undefined);
    try { remember({ version: 1, quote: await client.researchQuote({ draftId, allocationId }), submitted: false }); setReport(undefined); setReverted(false); }
    catch { setMessage("This report service is not available for this Space. It needs the configured demo asset and a seller address."); }
    finally { setBusy(false); }
  }

  async function buy(recoveredHash?: Hex) {
    if (!quote || !publicClient) return;
    setBusy(true); setMessage(undefined);
    try {
      if (connection.chainId !== 11155111 || connection.address?.toLowerCase() !== account.toLowerCase()) throw new PurchaseMessage("Reconnect the signed-in agent wallet on Sepolia.");
      let transactionHash = recoveredHash ?? hash;
      if (!transactionHash) {
        if (Date.parse(quote.expiresAt) <= Date.now()) throw new PurchaseMessage("This quote expired. Request a new quote before paying. If a payment was already sent, use its transaction hash to retrieve the report.");
        setStage("Checking permission and recipient…");
        const authorization = await client.authorizePayment({ draftId, allocationId: quote.allocationId,
          requestKey: quote.id, recipient: getAddress(quote.recipient), amount: quote.amount });
        if (!authorization.signature || authorization.riskVerdict !== "allow") throw new PurchaseMessage("Payment was not authorized.");
        setDecision(authorization.decision);
        const p = authorization.permit;
        if (authorization.spaceAddress.toLowerCase() !== quote.spaceAddress.toLowerCase() ||
          p.actor.toLowerCase() !== account.toLowerCase() || p.recipient.toLowerCase() !== quote.recipient.toLowerCase() ||
          p.amount !== quote.amount || p.allocationId !== quote.allocationId || p.action !== PermitAction.Pay ||
          p.requestId !== keccak256(toBytes(quote.id))) throw new PurchaseMessage("The authorization does not match this purchase.");
        // Save before opening the wallet: an interrupted response may hide an already-sent transaction.
        remember({ version: 1, quote, submitted: true });
        setStage("Confirm in your wallet…");
        transactionHash = await writeContractAsync({ address: getAddress(authorization.spaceAddress), abi: spaceAccountAbi,
          functionName: "pay", chainId: 11155111,
          args: [BigInt(p.allocationId), getAddress(p.recipient), BigInt(p.amount), {
            actor: getAddress(p.actor), action: p.action, allocationId: BigInt(p.allocationId), recipient: getAddress(p.recipient),
            amount: BigInt(p.amount), requestId: p.requestId as Hex, nonce: BigInt(p.nonce), expiry: BigInt(p.expiry),
            policyVersion: BigInt(p.policyVersion), detailsHash: p.detailsHash as Hex,
          }, authorization.signature as Hex] });
      }
      remember({ version: 1, quote, hash: transactionHash, submitted: true });
      setStage("Waiting for payment confirmation…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, timeout: 90_000,
        onReplaced: ({ transactionReceipt, reason }) => {
          transactionHash = transactionReceipt.transactionHash;
          remember({ version: 1, quote, hash: transactionHash, submitted: true });
          if (reason === "cancelled") setReverted(true);
        } });
      if (receipt.status !== "success") { setReverted(true); throw new PurchaseMessage("The payment reverted. No funds were paid; you can start a new purchase."); }
      setStage("Retrieving your report…");
      await queryClient.invalidateQueries({ queryKey: ["space-terms", quote.spaceAddress] });
      await queryClient.invalidateQueries({ queryKey: ["space-activity", quote.spaceAddress] });
      setReport(await client.researchRedeem({ quoteId: quote.id, transactionHash: receipt.transactionHash }));
    } catch (error) {
      const nextDecision = paymentDecision(error);
      if (error instanceof BaseError && error.walk((cause) => cause instanceof UserRejectedRequestError)) {
        remember({ version: 1, quote, submitted: false });
        setDecision(undefined);
        setMessage("You declined the wallet request. No payment was submitted; retry or request a fresh quote.");
      }
      else if (nextDecision) setDecision(nextDecision);
      else if (error instanceof PurchaseMessage) setMessage(error.message);
      else setMessage("The purchase did not finish. If your wallet sent a transaction, retrieve it using the payment reference. Retrieval never asks for another payment. If the wallet request was rejected, retry the same purchase.");
    } finally { setBusy(false); setStage(""); }
  }

  function recover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("transactionHash") ?? "").trim();
    if (!validTransactionHash.test(value)) { setMessage("Enter the full transaction hash from your wallet activity."); return; }
    void buy(value as Hex);
  }

  return <article className="research-purchase">
    <div className="research-purchase__intro"><div><h4>Give your agent a task</h4><p>Purchase an onchain spending report: funds remaining, daily headroom, and ENS authority at the payment block. The service verifies the exact receipt before releasing the result.</p></div><span>Demo research service</span></div>
    {saved.isPending ? <p role="status">Checking for a saved purchase…</p> : null}
    {!saved.isPending && !saved.data?.submitted ? <form onSubmit={requestQuote} className="space-console__form compact">
      <Label className="space-console__field">Agent allocation ID<Input name="allocationId" inputMode="numeric" required placeholder="2" /></Label>
      <Button variant="outline" disabled={busy}>Get report quote</Button>
    </form> : null}
    {quote ? <div className="research-purchase__quote"><div><strong>{quote.title} · {units(quote.amount)}</strong><p>Seller <span className="address-text">{quote.recipient}</span></p><small>Quote expires {new Date(quote.expiresAt).toLocaleTimeString()} · Allocation {quote.allocationId}</small><p>Purchase reference: <span className="address-text">{quote.id}</span></p></div>
      {!report && !reverted ? <Button onClick={() => void buy()} disabled={busy || decimals === undefined}>{busy ? stage || "Checking purchase…" : hash ? "Retrieve paid report" : saved.data?.submitted ? "Retry same wallet request" : `Pay ${units(quote.amount)} & get report`}</Button> : null}
    </div> : null}
    {saved.data?.submitted && !report && !reverted ? <div className="research-purchase__recovery"><p>Your purchase reference is saved in this browser for this wallet and Space. Retrieve an existing payment without paying again. If the wallet response was interrupted, use the transaction hash from wallet activity.</p><form onSubmit={recover} className="space-console__form compact"><Label className="space-console__field">Existing payment hash<Input name="transactionHash" placeholder="0x…" required autoComplete="off" /></Label><Button variant="outline" disabled={busy}>Retrieve existing payment</Button></form></div> : null}
    {storageWarning ? <p role="status">Browser storage is unavailable. Keep this page open and save the purchase and payment references.</p> : null}
    {decision ? <PaymentDecision decision={decision} settled={!!report} /> : null}
    {message ? <p role="status" className="research-purchase__message">{message}</p> : null}
    {hash ? <p className="research-purchase__receipt">Payment reference: <span className="address-text">{hash}</span>{process.env.NEXT_PUBLIC_ACCORD_LOCAL_E2E !== "1" ? <> · <a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">View receipt</a></> : null}</p> : null}
    {report ? <section className="research-purchase__result" aria-label="Purchased spending report"><h4>Report delivered</h4><p>Verified payment · snapshot at block {report.blockNumber}</p>
      <dl><div><dt>Allocation remaining</dt><dd>{units(report.remaining)}</dd></div><div><dt>Daily headroom</dt><dd>{units(report.dailyRemaining)}</dd></div><div><dt>Maximum payment</dt><dd>{units(report.maxPerPayment)}</dd></div><div><dt>ENS authority</dt><dd>{report.ensAuthorized ? "Active" : "Unavailable"}</dd></div></dl>
      <p>{report.mandateActive ? "Mandate active" : "Mandate inactive"} · expires {new Date(report.mandateExpiry).toLocaleString()}. This snapshot describes the payment block; current permissions may change.</p>
    </section> : null}
    {report || reverted ? <Button variant="outline" onClick={() => { remember(null); setReport(undefined); setReverted(false); setDecision(undefined); setMessage(undefined); }}>Start another purchase</Button> : null}
  </article>;
}
