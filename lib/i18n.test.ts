import { describe, expect, it } from "vitest";
import { getT } from "./i18n";

// CZ/EN parity guard (Phase 7): every key present in the EN dictionary must
// exist in the CS dictionary too — a missing CS key silently renders
// `undefined` in the Czech UI. Recursive because sections like the ERR_CS
// maps are nested objects.
function keyPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return prefix ? [prefix] : [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k)
  );
}

describe("i18n parity", () => {
  it("CS dictionary has every EN key", () => {
    const en = keyPaths(getT("en"));
    const cs = new Set(keyPaths(getT("cs")));
    const missing = en.filter((k) => !cs.has(k));
    expect(missing).toEqual([]);
  });

  it("CS dictionary has no extra keys EN lacks", () => {
    const cs = keyPaths(getT("cs"));
    const en = new Set(keyPaths(getT("en")));
    const extra = cs.filter((k) => !en.has(k));
    expect(extra).toEqual([]);
  });

  it("no dictionary value renders empty", () => {
    for (const t of [getT("en"), getT("cs")]) {
      for (const k of keyPaths(t)) {
        const v = k.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], t);
        if (typeof v === "string") expect(v.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
