import { describe, expect, it } from "vitest";
import { activationStorageKey, readActivation, saveActivation } from "./activation-storage";

describe("activation recovery", () => {
  it("retains a submitted transaction across reloads, then clears it after completion", () => {
    const data = new Map<string, string>();
    const store = { getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
    const key = activationStorageKey("0xABC", "draft-1");
    const hash = `0x${"a".repeat(64)}` as const;
    expect(saveActivation(store, key, hash)).toBe(true);
    expect(readActivation(store, activationStorageKey("0xabc", "draft-1"))).toBe(hash);
    expect(readActivation(store, activationStorageKey("0xdef", "draft-1"))).toBeNull();
    expect(readActivation(store, activationStorageKey("0xabc", "draft-2"))).toBeNull();
    expect(saveActivation(store, key, null)).toBe(true);
    expect(readActivation(store, key)).toBeNull();
  });

  it("ignores malformed storage and reports unavailable persistence", () => {
    const store = { getItem: () => "not-a-transaction", setItem: () => { throw new Error("Storage unavailable"); }, removeItem: () => {} };
    expect(readActivation(store, "draft")).toBeNull();
    expect(saveActivation(store, "draft", `0x${"a".repeat(64)}`)).toBe(false);
  });
});
