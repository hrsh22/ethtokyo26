"use client";

import { PermitAction, spaceAccountAbi } from "@accord/chain";
import { paymentDecision, type AccordClient, type Decision } from "@accord/sdk";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSearch, RotateCcw } from "lucide-react";
import { BaseError, UserRejectedRequestError, encodeFunctionData, getAddress, keccak256, toBytes, type Hex } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { amount as formatAmount, shortAddress } from "@/lib/format";
import { explorerTx } from "@/lib/use-chain-actions";
import { useSponsoredTransaction } from "@/lib/use-sponsored-transaction";
import { purchaseStorageKey, readPurchase, savePurchase, transactionHash as validTransactionHash, type SavedPurchase } from "@/lib/purchase-storage";
import { PaymentDecision } from "./payment-decision";
import { Button } from "./ui/button";

type Report = Awaited<ReturnType<AccordClient["researchRedeem"]>>;
class PurchaseMessage extends Error {}

/** A demo paid task: the agent buys a report, and the seller releases it only after verifying the exact onchain payment. */
export function ResearchPurchase({ client, draftId, allocationId, decimals, symbol, account }: {
  client: AccordClient; draftId: string; allocationId: string; decimals?: number; symbol: string; account: string;
}) {
  const publicClient = usePublicClient({ chainId: 11155111 });
  const connection = useAccount();
  const sponsor = useSponsoredTransaction();
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
  const units = (value: string) => formatAmount(BigInt(value), decimals, symbol);

  function remember(purchase: SavedPurchase | null) {
    queryClient.setQueryData(purchaseKey, purchase);
    try { setStorageWarning(!savePurchase(window.localStorage, storageKey, purchase)); }
    catch { setStorageWarning(true); }
  }

  async function requestQuote() {
    setBusy(true); setMessage(undefined); setDecision(undefined);
    try { remember({ version: 1, quote: await client.researchQuote({ draftId, allocationId }), submitted: false }); setReport(undefined); setReverted(false); }
    catch { setMessage("The report service isn't available for this Space. It needs tUSDC and a configured seller."); }
    finally { setBusy(false); }
  }

  async function buy(recoveredHash?: Hex) {
    if (!quote || !publicClient) return;
    setBusy(true); setMessage(undefined);
    try {
      if (connection.chainId !== 11155111 || connection.address?.toLowerCase() !== account.toLowerCase()) throw new PurchaseMessage("Reconnect the signed-in agent wallet on Sepolia.");
      let transactionHash = recoveredHash ?? hash;
      if (!transactionHash) {
        if (Date.parse(quote.expiresAt) <= Date.now()) throw new PurchaseMessage("This quote expired. Get a new one before paying. If you already paid, retrieve the report with the payment's transaction hash.");
        setStage("Checking the mandate and screening the seller");
        const authorization = await client.authorizePayment({ draftId, allocationId: quote.allocationId,
          requestKey: quote.id, recipient: getAddress(quote.recipient), amount: quote.amount });
        if (!authorization.signature || authorization.riskVerdict !== "allow") throw new PurchaseMessage("Payment was not authorized.");
        setDecision(authorization.decision);
        const p = authorization.permit;
        if (authorization.spaceAddress.toLowerCase() !== quote.spaceAddress.toLowerCase() ||
          p.actor.toLowerCase() !== account.toLowerCase() || p.recipient.toLowerCase() !== quote.recipient.toLowerCase() ||
          p.amount !== quote.amount || p.allocationId !== quote.allocationId || p.action !== PermitAction.Pay ||
          p.requestId !== keccak256(toBytes(quote.id))) throw new PurchaseMessage("The authorization doesn't match this purchase.");
        // Save before opening the wallet: an interrupted response may hide an already-sent transaction.
        remember({ version: 1, quote, submitted: true });
        setStage("Sign the gasless payment");
        transactionHash = await sponsor.send(getAddress(authorization.spaceAddress), encodeFunctionData({ abi: spaceAccountAbi,
          functionName: "pay", args: [BigInt(p.allocationId), getAddress(p.recipient), BigInt(p.amount), {
            actor: getAddress(p.actor), action: p.action, allocationId: BigInt(p.allocationId), recipient: getAddress(p.recipient),
            amount: BigInt(p.amount), requestId: p.requestId as Hex, nonce: BigInt(p.nonce), expiry: BigInt(p.expiry),
            policyVersion: BigInt(p.policyVersion), detailsHash: p.detailsHash as Hex,
          }, authorization.signature as Hex] }));
      }
      remember({ version: 1, quote, hash: transactionHash, submitted: true });
      setStage("Waiting for the payment to confirm");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, timeout: 90_000,
        onReplaced: ({ transactionReceipt, reason }) => {
          transactionHash = transactionReceipt.transactionHash;
          remember({ version: 1, quote, hash: transactionHash, submitted: true });
          if (reason === "cancelled") setReverted(true);
        } });
      if (receipt.status !== "success") { setReverted(true); throw new PurchaseMessage("The payment reverted. Nothing was paid; you can start a new purchase."); }
      setStage("Fetching your report");
      await Promise.all(["space-terms", "space-activity", "allocation"].map((key) => queryClient.invalidateQueries({ queryKey: [key, getAddress(quote.spaceAddress)] })));
      setReport(await client.researchRedeem({ quoteId: quote.id, transactionHash: receipt.transactionHash }));
    } catch (error) {
      const nextDecision = paymentDecision(error);
      if (error instanceof BaseError && error.walk((cause) => cause instanceof UserRejectedRequestError)) {
        remember({ version: 1, quote, submitted: false });
        setDecision(undefined);
        setMessage("You declined in your wallet, so nothing was paid. Try again or get a fresh quote.");
      }
      else if (nextDecision) setDecision(nextDecision);
      else if (error instanceof PurchaseMessage) setMessage(error.message);
      else setMessage("The purchase didn't finish. If your wallet sent a payment, retrieve it with the transaction hash below. Retrieving never charges again.");
    } finally { setBusy(false); setStage(""); }
  }

  function recover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("transactionHash") ?? "").trim();
    if (!validTransactionHash.test(value)) { setMessage("Paste the full transaction hash from your wallet activity."); return; }
    void buy(value as Hex);
  }

  const receiptLink = hash ? explorerTx(hash) : undefined;
  return <section className="card p-6" aria-labelledby="task-heading">
    <div className="flex items-start gap-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-sky-soft text-[#2B7CC4]"><FileSearch size={22} /></span>
      <div><h2 id="task-heading" className="font-display text-2xl font-extrabold">Give your agent a task</h2>
        <p className="mt-1 text-sm text-muted">Buy an onchain spending report from the demo research service. The seller checks the exact payment before releasing it.</p></div>
    </div>
    {saved.isPending ? <p role="status" className="mt-4 text-sm text-muted">Checking for a saved purchase…</p> : null}
    {!saved.isPending && !quote ? <Button variant="soft" className="mt-5" loading={busy} onClick={() => void requestQuote()}>Get a quote</Button> : null}
    {quote ? <div className="mt-5 rounded-3xl bg-soft p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><b className="text-lg">{quote.title}</b><b className="font-display text-2xl font-extrabold">{units(quote.amount)}</b></div>
      <p className="mt-1 text-sm text-muted">Seller <span className="address">{shortAddress(quote.recipient)}</span>. Quote valid until {new Date(quote.expiresAt).toLocaleTimeString()}.</p>
      {!report && !reverted ? <Button className="mt-4" loading={busy} onClick={() => void buy()}>{busy ? stage || "Working" : hash ? "Retrieve the report" : saved.data?.submitted ? "Retry the same payment" : `Pay ${units(quote.amount)} and get the report`}</Button> : null}
    </div> : null}
    {saved.data?.submitted && !report && !reverted ? <details className="mt-4 text-sm">
      <summary className="cursor-pointer font-semibold text-muted">Paid but the report didn’t arrive?</summary>
      <p className="mt-2 text-muted">Your purchase is saved in this browser. Paste the payment’s transaction hash to fetch the report without paying again.</p>
      <form onSubmit={recover} className="mt-2 flex gap-2"><label htmlFor="report-hash" className="sr-only">Payment transaction hash</label>
        <input id="report-hash" name="transactionHash" className="field" placeholder="0x…" required autoComplete="off" spellCheck={false} />
        <Button variant="soft" className="h-[50px]" disabled={busy}>Retrieve</Button></form>
    </details> : null}
    {storageWarning ? <p role="status" className="mt-3 text-sm text-warn">Browser storage is off. Keep this page open and note the transaction hash.</p> : null}
    {decision ? <div className="mt-4"><PaymentDecision decision={decision} settled={!!report} /></div> : null}
    {message ? <p role="status" className="mt-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn">{message}</p> : null}
    {hash ? <p className="mt-3 text-sm text-muted">Payment <span className="address">{shortAddress(hash)}</span>{receiptLink ? <> · <a href={receiptLink} target="_blank" rel="noreferrer" className="font-semibold text-[#6f4bea]">receipt</a></> : null}</p> : null}
    {report ? <section aria-label="Purchased spending report" className="mt-5 rounded-3xl bg-lime-soft p-5">
      <h3 className="font-display text-xl font-extrabold">Report delivered</h3>
      <p className="text-sm text-muted">Verified payment, snapshot at block {report.blockNumber}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {[["Budget left", units(report.remaining)], ["Left today", units(report.dailyRemaining)], ["Max per payment", units(report.maxPerPayment)], ["ENS authority", report.ensAuthorized ? "Active" : "Unavailable"]].map(([term, value]) =>
          <div key={term} className="rounded-2xl bg-white p-3"><dt className="text-muted">{term}</dt><dd className="font-semibold">{value}</dd></div>)}
      </dl>
      <p className="mt-3 text-sm text-muted">{report.mandateActive ? "Mandate active" : "Mandate inactive"}, ends {new Date(report.mandateExpiry).toLocaleString()}. This describes the payment block; permissions may have changed since.</p>
    </section> : null}
    {report || reverted ? <Button variant="soft" className="mt-4" onClick={() => { remember(null); setReport(undefined); setReverted(false); setDecision(undefined); setMessage(undefined); }}><RotateCcw />Start another purchase</Button> : null}
  </section>;
}
