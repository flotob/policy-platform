import { describe, expect, it } from "vitest";

import { sameSender, senderKey } from "../src/kern/absender.ts";

describe("one sender, however it is typed", () => {
  it("ignores case, outer and doubled spaces", () => {
    expect(senderKey("  Stadtwerke   musterstadt ")).toBe(senderKey("Stadtwerke Musterstadt"));
    expect(senderKey("ÖKO-Institut")).toBe(senderKey("öko-institut"));
  });

  it("treats composed and decomposed umlauts alike", () => {
    expect(senderKey("Bürgerverein")).toBe(senderKey("Bürgerverein"));
  });

  it("keeps different names apart", () => {
    expect(senderKey("Stadtwerke Musterstadt")).not.toBe(senderKey("Stadtwerke Musterstadt GmbH"));
  });

  it("returns the spelling used first", () => {
    expect(sameSender("stadtwerke musterstadt", ["Elternbeirat", "Stadtwerke Musterstadt"])).toBe("Stadtwerke Musterstadt");
    expect(sameSender("Gewerbeverein", ["Elternbeirat"])).toBeNull();
    expect(sameSender("   ", ["Elternbeirat"])).toBeNull();
  });
});
