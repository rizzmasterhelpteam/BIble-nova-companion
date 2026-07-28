import { describe, expect, it } from "vitest";
import { createNativeRecoveryStorage } from "../src/lib/native/storage";

const createMemoryStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      get length() {
        return values.size;
      },
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
      removeItem(key: string) {
        values.delete(key);
      },
      key(index: number) {
        return [...values.keys()][index] ?? null;
      },
    },
  };
};

describe("native Voice recovery storage", () => {
  it("persists and clears Voice recovery values without touching unrelated data", async () => {
    const { values, storage } = createMemoryStorage();
    values.set("unrelated", "keep");
    const recovery = createNativeRecoveryStorage(() => storage);

    await recovery.set("request", "request-id");
    await recovery.set("lease", "lease-id");
    expect(await recovery.get("request")).toBe("request-id");
    expect(await recovery.get("lease")).toBe("lease-id");

    await recovery.remove("request");
    expect(await recovery.get("request")).toBeNull();

    await recovery.clear();
    expect(await recovery.get("lease")).toBeNull();
    expect(values.get("unrelated")).toBe("keep");
  });

  it("keeps recovery available in memory when WebView storage throws", async () => {
    const brokenStorage = {
      length: 0,
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
      key() {
        return null;
      },
    };
    const recovery = createNativeRecoveryStorage(() => brokenStorage);

    await recovery.set("request", "request-id");
    expect(await recovery.get("request")).toBe("request-id");
    await recovery.remove("request");
    expect(await recovery.get("request")).toBeNull();
  });
});
