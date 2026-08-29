/**
 * Conformance scan: a STOCK KEY is never taken from a merchandising label.
 *
 * `skuRef: snapshot.sku` type-checks (both are `string`), reads plausibly, and
 * ships. Downstream it decrements a quant nothing is stocked under — the row
 * goes NEGATIVE while the real units sit under the stamped ref, and nothing
 * throws because a move carrying a reservation may go negative. The rule and
 * `stockKeyOf` already existed when that shipped; what was missing was a gate.
 *
 * Every package that resolves a stock key runs this over its own `src`, the way
 * `@classytic/arc/testing`'s store contracts are run by their implementors. The
 * matcher lives HERE so a fix to it reaches every consumer at once — a regex
 * copied per package is the same drift one layer up.
 *
 * Node-only (`node:fs`), so it is a `/testing` subpath and never reachable from
 * the isomorphic value-object entries.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface StockKeyViolation {
  /** Path relative to the scanned root. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** The offending source line, trimmed. */
  text: string;
}

/** `skuRef` being assigned — property (`skuRef:`) or binding (`const skuRef =`). Both are the same defect. */
const ASSIGNS_STOCK_KEY = /\bskuRef\s*[:=]\s*([^,;{}\n]*)/;
/** The right-hand side reads a `.sku` label. `(?!Ref)` so `.skuRef` is not a `.sku` hit. */
const READS_LABEL = /\.sku\b(?!Ref)/;
/** The right-hand side already reads the stamped ref, i.e. it IS the `skuRef ?? sku` fallback. */
const READS_REF = /\.skuRef\b/;

/**
 * Does this line take a stock key from a label?
 *
 * The class is "assigns `skuRef` from an expression that reads `.sku` and never
 * reads `.skuRef`". Matching `.sku` alone flags the CORRECT idiom
 * (`line.skuRef ?? line.sku`), and a gate that cries wolf is a gate someone
 * deletes — so the ref-read is what distinguishes a fallback from a label grab.
 */
export function takesStockKeyFromLabel(line: string): boolean {
  const rhs = ASSIGNS_STOCK_KEY.exec(line)?.[1];
  if (rhs === undefined) return false;
  return READS_LABEL.test(rhs) && !READS_REF.test(rhs);
}

/** @deprecated Kept for callers that want the raw predicate; prefer {@link takesStockKeyFromLabel}. */
export const STOCK_KEY_FROM_LABEL = { test: takesStockKeyFromLabel };

/** Lines that are prose, not code. */
const isComment = (trimmed: string): boolean =>
  trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*");

function tsFilesIn(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsFilesIn(full, acc);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) acc.push(full);
  }
  return acc;
}

export interface StockKeySeamScan {
  /** How many source files were read — assert a floor, or the gate can pass on an empty tree. */
  scanned: number;
  violations: StockKeyViolation[];
}

/** Scan a package's `src` root. Pure: returns findings, throws nothing. */
export function scanStockKeySeam(srcRoot: string): StockKeySeamScan {
  const files = tsFilesIn(srcRoot);
  const violations: StockKeyViolation[] = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? "";
      const trimmed = raw.trim();
      if (isComment(trimmed)) continue;
      if (takesStockKeyFromLabel(raw)) {
        violations.push({ file: relative(srcRoot, file), line: i + 1, text: trimmed.slice(0, 120) });
      }
    }
  }

  return { scanned: files.length, violations };
}

/**
 * Throwing form for a one-line test. `minFiles` is the scan-volume floor: a gate
 * that quietly scanned nothing passes forever, so state what "ran" means.
 */
export function assertStockKeySeam(srcRoot: string, opts: { minFiles: number }): void {
  const { scanned, violations } = scanStockKeySeam(srcRoot);

  if (scanned < opts.minFiles) {
    throw new Error(
      `stock-key seam REFUSING to pass: scanned only ${scanned} file(s) under ${srcRoot}, expected >= ${opts.minFiles}`,
    );
  }

  if (violations.length > 0) {
    const list = violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join("\n");
    throw new Error(
      `A stock key must come from stockKeyOf() (skuRef ?? sku), never from the .sku label:\n${list}`,
    );
  }
}

/**
 * The fixtures the matcher must and must not fire on — exported so every
 * adopting package falsifies the DETECTOR, not just its own current cleanliness.
 * Both live defects are here verbatim.
 */
export const STOCK_KEY_SEAM_FIXTURES = {
  mustMatch: [
    "        skuRef: (snapshot.sku as string | undefined) ?? '',",
    "        skuRef: snap?.sku ?? '',",
    "      const skuRef = line.snapshot?.sku ?? line.offerId;",
    "        skuRef: (line.snapshot?.sku ?? line.offerId) as string,",
  ],
  mustNotMatch: [
    "        skuRef: stockKeyOf(snapshot) ?? '',",
    "        skuRef: line.skuRef,",
    "        sku: (snapshot.sku as string | undefined) ?? '',",
    "      const label = variant.sku ?? variant.skuRef;",
    // The CORRECT hand-rolled fallback. Flagging it is what makes a gate noisy
    // enough to be deleted, so it is a fixture in its own right.
    "      const skuRef = line.skuRef ?? line.sku;",
    "        skuRef: item.skuRef ?? item.sku,",
  ],
} as const;
