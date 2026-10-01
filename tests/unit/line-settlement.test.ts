/**
 * Line settlement: one answer to "how much of this line is still open".
 * Fixtures use several buckets at once — the shape a real transfer line has
 * after a partial receipt plus a loss, which a single-bucket fixture cannot see.
 */
import { describe, expect, it } from "vitest";

import {
  clampSettlement,
  documentSettlementState,
  outstandingOf,
  planSettlement,
  settledEntirelyIn,
  settlementState,
  type SettlementLine,
} from "../../src/inventory/line-settlement.js";

type Outcome = "received" | "returned" | "writtenOff";
const line = (quantity: number, settled: Partial<Record<Outcome, number>> = {}): SettlementLine<Outcome> => ({
  quantity,
  settled,
});

describe("outstanding and state", () => {
  it("subtracts every bucket, absent counting as zero", () => {
    expect(outstandingOf(line(100, { received: 90, writtenOff: 4 }))).toBe(6);
    expect(settlementState(line(100))).toBe("open");
    expect(settlementState(line(100, { returned: 1 }))).toBe("partial");
    expect(settlementState(line(100, { received: 90, returned: 6, writtenOff: 4 }))).toBe("settled");
  });

  it("does not clamp an over-settled line — the negative is the signal", () => {
    expect(outstandingOf(line(5, { received: 7 }))).toBe(-2);
    expect(settlementState(line(5, { received: 7 }))).toBe("settled");
  });

  it("derives the document state from every line", () => {
    expect(documentSettlementState([line(2), line(3)])).toBe("open");
    expect(documentSettlementState([line(2, { received: 2 }), line(3)])).toBe("partial");
    expect(documentSettlementState([line(2, { received: 2 }), line(3, { writtenOff: 3 })])).toBe("settled");
  });

  it("tells a fully received document from one closed with losses", () => {
    const received = [line(2, { received: 2 }), line(3, { received: 3 })];
    const closed = [line(2, { received: 2 }), line(3, { received: 1, writtenOff: 2 })];
    expect(settledEntirelyIn(received, "received")).toBe(true);
    expect(settledEntirelyIn(closed, "received")).toBe(false);
  });
});

describe("planSettlement refuses instead of trimming", () => {
  it("adds to the named bucket only", () => {
    const r = planSettlement(line(10, { received: 3 }), "returned", 2);
    expect(r).toEqual({ ok: true, value: line(10, { received: 3, returned: 2 }) });
  });

  it("refuses more than is outstanding, naming the outstanding", () => {
    expect(planSettlement(line(10, { received: 8 }), "writtenOff", 3)).toEqual({
      ok: false,
      error: { code: "exceeds_outstanding", requested: 3, outstanding: 2 },
    });
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses %s", (q) => {
    const r = planSettlement(line(10), "received", q);
    expect(r.ok).toBe(false);
  });
});

describe("clampSettlement takes what fits", () => {
  it("applies at most the outstanding and reports what it applied", () => {
    expect(clampSettlement(line(10, { received: 8 }), "received", 5)).toEqual({
      line: line(10, { received: 10 }),
      applied: 2,
    });
    expect(clampSettlement(line(10, { received: 10 }), "received", 5).applied).toBe(0);
  });
});

describe("shareOfSettled — batch shares that always sum to the line", () => {
  it("telescopes to the total for ANY split, with an indivisible total", async () => {
    const { shareOfSettled } = await import("../../src/inventory/line-settlement.js");
    const total = 1_000; // 1000 minor over 3 units: no even split exists
    for (const splits of [[1, 1, 1], [2, 1], [1, 2], [3], [1, 1, 0, 1]]) {
      let before = 0;
      let sum = 0;
      for (const n of splits) {
        sum += shareOfSettled(total, 3, before, before + n);
        before += n;
      }
      expect(sum).toBe(total);
    }
  });

  it("an empty batch owes nothing, and bad bounds are refused", async () => {
    const { shareOfSettled } = await import("../../src/inventory/line-settlement.js");
    expect(shareOfSettled(999, 3, 2, 2)).toBe(0);
    expect(() => shareOfSettled(999, 3, 2, 4)).toThrow(RangeError);
    expect(() => shareOfSettled(9.5, 3, 0, 1)).toThrow(RangeError);
  });
});
