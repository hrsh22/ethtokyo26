import type { AccordClient } from "@accord/sdk";
import type { Hex } from "viem";

type Quote = Awaited<ReturnType<AccordClient["researchQuote"]>>;
export type SavedPurchase = { version: 1; quote: Quote; hash?: Hex; submitted: boolean };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const address = /^0x[0-9a-f]{40}$/i;
export const transactionHash = /^0x[0-9a-f]{64}$/i;
const integer = /^[1-9][0-9]{0,77}$/;

// Public references only. Authority always comes from the API and onchain receipt.
export function purchaseStorageKey(account: string, draftId: string, allocationId?: string) {
  return `accord:report:v1:11155111:${account.toLowerCase()}:${draftId}${allocationId ? `:${allocationId}` : ""}`;
}
export function readPurchase(store: Store, key: string, draftId: string, allocationId?: string): SavedPurchase | null {
  try {
    const raw = store.getItem(key);
    if (!raw || raw.length > 4096) return null;
    const value = JSON.parse(raw) as SavedPurchase;
    const q = value?.quote;
    if (value.version !== 1 || typeof value.submitted !== "boolean" || !q || q.draftId !== draftId ||
      (allocationId !== undefined && q.allocationId !== allocationId) ||
      !uuid.test(q.id) || typeof q.allocationId !== "string" || typeof q.amount !== "string" || !integer.test(q.allocationId) || !integer.test(q.amount) ||
      !address.test(q.spaceAddress) || !address.test(q.tokenAddress) || !address.test(q.recipient) ||
      typeof q.title !== "string" || q.title.length > 100 || typeof q.expiresAt !== "string" || !Number.isFinite(Date.parse(q.expiresAt)) ||
      (value.hash !== undefined && (!transactionHash.test(value.hash) || !value.submitted))) return null;
    return { version: 1, quote: { id: q.id, title: q.title, draftId: q.draftId, allocationId: q.allocationId,
      spaceAddress: q.spaceAddress, tokenAddress: q.tokenAddress, recipient: q.recipient,
      amount: q.amount, expiresAt: q.expiresAt }, hash: value.hash, submitted: value.submitted };
  } catch { return null; }
}
/** Keep existing purchases recoverable while isolating multiple budgets for the same wallet. */
export function readAllocationPurchase(store: Store, account: string, draftId: string, allocationId: string) {
  const key = purchaseStorageKey(account, draftId, allocationId);
  const current = readPurchase(store, key, draftId, allocationId);
  if (current) return current;
  const legacyKey = purchaseStorageKey(account, draftId);
  const legacy = readPurchase(store, legacyKey, draftId, allocationId);
  if (legacy && savePurchase(store, key, legacy)) savePurchase(store, legacyKey, null);
  return legacy;
}
export function savePurchase(store: Store, key: string, purchase: SavedPurchase | null): boolean {
  try {
    if (purchase) store.setItem(key, JSON.stringify(purchase));
    else store.removeItem(key);
    return true;
  } catch { return false; }
}
