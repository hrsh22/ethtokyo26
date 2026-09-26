import { describe, expect, it } from "vitest";
import { purchaseStorageKey, readAllocationPurchase, readPurchase, savePurchase, type SavedPurchase } from "./purchase-storage";

const draftId = "12345678-1234-1234-1234-123456789abc";
const wallet = `0x${"a".repeat(40)}`;
const quote = { id: "87654321-1234-1234-1234-123456789abc", draftId, title: "Agent spending report",
  allocationId: "2", amount: "100", spaceAddress: wallet, tokenAddress: wallet, recipient: wallet,
  expiresAt: new Date(0).toISOString() };
const purchase: SavedPurchase = { version: 1, quote, hash: `0x${"b".repeat(64)}`, submitted: true };
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
describe("purchase recovery", () => {
  it("isolates multiple agent budgets for the same wallet and Space", () => {
    const store = storage();
    savePurchase(store, purchaseStorageKey(wallet, draftId, "2"), purchase);
    expect(readAllocationPurchase(store, wallet, draftId, "2")).toEqual(purchase);
    expect(readAllocationPurchase(store, wallet, draftId, "3")).toBeNull();
    savePurchase(store, purchaseStorageKey(wallet, draftId, "3"), purchase);
    expect(readAllocationPurchase(store, wallet, draftId, "3")).toBeNull();
  });
  it("migrates an existing purchase only into the matching allocation", () => {
    const store = storage(), oldKey = purchaseStorageKey(wallet, draftId);
    savePurchase(store, oldKey, purchase);
    expect(readAllocationPurchase(store, wallet, draftId, "1")).toBeNull();
    expect(readPurchase(store, oldKey, draftId)).toEqual(purchase);
    expect(readAllocationPurchase(store, wallet, draftId, "2")).toEqual(purchase);
    expect(readPurchase(store, oldKey, draftId)).toBeNull();
    expect(readAllocationPurchase(store, wallet, draftId, "2")).toEqual(purchase);
  });
  it("retains the legacy recovery record if scoped storage cannot be written", () => {
    const store = storage(), oldKey = purchaseStorageKey(wallet, draftId);
    savePurchase(store, oldKey, purchase);
    const unavailable = { ...store, setItem: () => { throw Error(); } };
    expect(readAllocationPurchase(unavailable, wallet, draftId, "2")).toEqual(purchase);
    expect(readPurchase(store, oldKey, draftId)).toEqual(purchase);
  });
  it("restores an expired quote with a submitted receipt for delivery, not repayment", () => {
    const store = storage(); const key = purchaseStorageKey(wallet, draftId);
    expect(savePurchase(store, key, purchase)).toBe(true);
    expect(readPurchase(store, key, draftId)).toEqual(purchase);
  });
  it("isolates wallets and Spaces while normalizing wallet case", () => {
    const store = storage(); const key = purchaseStorageKey(wallet, draftId);
    savePurchase(store, key, purchase);
    expect(readPurchase(store, purchaseStorageKey(wallet.toUpperCase(), draftId), draftId)).toEqual(purchase);
    expect(readPurchase(store, purchaseStorageKey(`0x${"c".repeat(40)}`, draftId), draftId)).toBeNull();
    expect(readPurchase(store, key, "another-draft")).toBeNull();
  });
  it.each(["{", JSON.stringify({ ...purchase, version: 2 }), JSON.stringify({ ...purchase, hash: "bad" }),
    JSON.stringify({ ...purchase, quote: { ...quote, amount: "-1" } }), JSON.stringify({ ...purchase, quote: { ...quote, amount: 100 } })])("ignores corrupted or unsupported data", (raw) => {
    const store = storage(); store.setItem("key", raw); expect(readPurchase(store, "key", draftId)).toBeNull();
  });
  it("keeps submission uncertainty without a returned wallet hash", () => {
    const store = storage(); const pending = { version: 1 as const, quote, submitted: true };
    savePurchase(store, "key", pending); expect(readPurchase(store, "key", draftId)).toMatchObject(pending);
  });
  it("handles unavailable storage without breaking payment recovery in memory", () => {
    const store = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); }, removeItem: () => { throw Error(); } };
    expect(readPurchase(store, "key", draftId)).toBeNull(); expect(savePurchase(store, "key", purchase)).toBe(false);
  });
  it("clears only the selected purchase", () => {
    const store = storage(); savePurchase(store, "a", purchase); savePurchase(store, "b", purchase);
    savePurchase(store, "a", null); expect(readPurchase(store, "a", draftId)).toBeNull();
    expect(readPurchase(store, "b", draftId)).toEqual(purchase);
  });
});
