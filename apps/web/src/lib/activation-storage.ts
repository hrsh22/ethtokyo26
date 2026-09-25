import type { Hex } from "viem";

export const activationHash = /^0x[0-9a-f]{64}$/i;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function activationStorageKey(account: string, draftId: string) {
  return `accord:activation:v1:11155111:${account.toLowerCase()}:${draftId}`;
}

// Only a public transaction reference is stored. The API verifies its owner,
// factory event, and deployed configuration before it can activate a draft.
export function readActivation(store: Store, key: string): Hex | null {
  try {
    const value = store.getItem(key);
    return value && activationHash.test(value) ? value as Hex : null;
  } catch { return null; }
}

export function saveActivation(store: Store, key: string, hash: Hex | null): boolean {
  try {
    if (hash) store.setItem(key, hash);
    else store.removeItem(key);
    return true;
  } catch { return false; }
}
