/**
 * Canonical bank-transaction shape — the single source of truth shared by
 * any package that parses, persists, or consumes bank-feed / accounting-
 * feed data.
 *
 * Anchored on `Money` from `@classytic/primitives/money` (integer minor
 * units, `number`). Same precision discipline ledger uses; no float
 * arithmetic, no Decimal.js, no bigint conversion friction at consumer
 * boundaries.
 *
 * Used by:
 *   - `@classytic/fin-io` parsers (OFX / CAMT.053 / MT940 / CSV / IIF /
 *     Plaid / QBO / Xero) — produce these shapes directly.
 *   - `@classytic/revenue` `transactionRepository.import()` /
 *     `parseAndImport()` / `drainSync()` — consume these shapes
 *     directly.
 *
 * Sign convention on `BankTransaction.amount`: positive = inflow to the
 * account holder, negative = outflow. Banks emit signed amounts; revenue
 * normalizes into the (unsigned `amount` + `flow`) shape it stores under.
 */

import type { Money } from './money.js';

// ─── Counterparty ────────────────────────────────────────────────────────

/**
 * The other side of a bank transaction. All fields optional — different
 * formats populate different subsets:
 *   OFX     usually carries `name` only.
 *   CAMT    carries IBAN + BIC + name (SEPA structured data).
 *   Plaid   carries `merchant_name` mapped to `name`.
 *   CSV     varies; usually `name` + maybe `accountNumber`.
 */
export interface BankCounterparty {
  /** Free-text name as the bank emits it. */
  name?: string;
  /**
   * Vendor-stable identifier — bank's own customer ID, structured
   * remittance reference (ISO 11649), etc. Distinct from the
   * transaction-level `reference`.
   */
  identifier?: string;
  /** International Bank Account Number (SEPA / EU). */
  iban?: string;
  /** Domestic account number. */
  accountNumber?: string;
  /** Bank / SWIFT BIC. */
  bic?: string;
  /** US ABA routing / Canadian transit. */
  routingNumber?: string;
}

// ─── Bank account header ─────────────────────────────────────────────────

/**
 * Identifies the account a statement / sync batch is for. Different
 * formats populate different subsets — consumers should treat every
 * field except `currency` as best-effort.
 */
export interface BankAccount {
  iban?: string;
  accountNumber?: string;
  /** US ABA / SWIFT BIC / domestic bank code. Generic — format-specific. */
  bankCode?: string;
  /** Human-readable bank name. */
  bankName?: string;
  /** Account holder name as the bank emits it. */
  ownerName?: string;
  /** Type as the bank classifies it: `'CHECKING'`, `'SAVINGS'`, `'CREDITLINE'`. */
  accountType?: string;
  /**
   * ISO 4217 of the account itself. REQUIRED — synthesized from format
   * defaults if absent (parsers MUST fill this in).
   */
  currency: string;
}

// ─── Single bank transaction ─────────────────────────────────────────────

/**
 * One row from a bank statement / accounting feed sync.
 *
 * `externalId` is REQUIRED — without it idempotent re-import is broken.
 * Synthesize one from `(date | amount | description hash)` if the
 * upstream format lacks a vendor-stable id.
 */
export interface BankTransaction {
  /**
   * Vendor-stable unique identifier. REQUIRED.
   *
   *   OFX:    `<FITID>` from the source file.
   *   CAMT:   `<NtryRef>` or `<AcctSvcrRef>`.
   *   QBO:    `Id` from the QBO API.
   *   Plaid:  `transaction_id`.
   *   CSV:    synthesized as `sha256(date|amount|description)` truncated
   *           to 16 hex chars; parser should emit a warning.
   *
   * Used by consumers to enforce idempotent re-import via
   * `(orgId, bankAccountId, externalId)` partial-unique indexes.
   * Distinct from any host-chosen request-scoped idempotency key.
   */
  externalId: string;

  /** When the bank booked the entry. */
  postedDate: Date;

  /** When funds become available (cleared). May equal `postedDate`. */
  valueDate?: Date;

  /**
   * Signed amount in integer minor units. Positive = inflow to the
   * account holder, negative = outflow. Currency carried inside `Money`.
   */
  amount: Money;

  /** Free-text description as the bank emitted it. */
  description: string;

  /** Counterparty (payer / payee) when the format provides one. */
  counterparty?: BankCounterparty;

  /** Bank-provided reference number, check number, end-to-end id. */
  reference?: string;

  /**
   * Bank-provided category if any. Rare in OFX / CAMT, common in
   * Plaid and consumer-finance CSV (Mint / YNAB).
   */
  category?: string;

  /** Running balance on the account after this entry, if available. */
  balanceAfter?: Money;

  /** Format-specific entry-type code (`'DEBIT'`, `'CREDIT'`, `'CHECK'`, …). */
  type?: string;

  /**
   * Vendor-side identifier of the account this row belongs to — Plaid
   * `account_id`, Xero `BankAccount.AccountID`. Sync feeds return transactions
   * spanning MULTIPLE accounts in one batch, so this lets a consumer route
   * each row to the right destination account per-transaction (multi-account
   * sync) instead of forcing the whole batch onto one account.
   *
   * Statement formats (OFX / CAMT.053 / MT940 / CSV / IIF) are single-account
   * files — they carry the account on `BankStatement.account` and leave this
   * `undefined`. Distinct from any consumer-side account id (e.g. the host's
   * own `bankAccountId` used in the import unique index).
   */
  sourceAccountId?: string;

  /**
   * The entry has not yet posted / cleared — the bank may still change its
   * amount, description, or drop it entirely. Real-time feeds populate this
   * (Plaid `pending: true`); statement formats (OFX / CAMT.053 / MT940 / CSV)
   * only ever carry settled rows and leave it `undefined`.
   *
   * Consumers MUST treat `pending: true` rows as provisional — do not
   * reconcile or post them as final, and expect a superseding posted row to
   * arrive later (linked via `supersedesExternalId`).
   */
  pending?: boolean;

  /**
   * Set on a POSTED row that replaces an earlier PENDING one: the
   * `externalId` of the pending row this entry supersedes (Plaid
   * `pending_transaction_id`).
   *
   * The pending and posted rows carry DIFFERENT `externalId`s, so dedup on
   * `externalId` alone can't collapse them — consumers MUST use this
   * back-pointer to drop / replace the superseded pending row on ingest, or
   * both versions persist as duplicates.
   */
  supersedesExternalId?: string;

  /**
   * Format-specific raw record. Pass-through for audit / debugging.
   * Consumers MUST NOT rely on this — schema may change between fin-io
   * minor versions. Discard before persistence if size is a concern.
   */
  raw?: unknown;
}

// ─── Statement (file upload header) ──────────────────────────────────────

/**
 * Aggregate envelope produced by file-format parsers (OFX, CAMT.053,
 * MT940, CSV, IIF). Sync providers (Plaid CDC, QBO CDC) emit
 * `BankTransaction[]` directly without the statement wrapper because
 * sync is continuous, not statement-scoped.
 */
export interface BankStatement {
  account: BankAccount;
  /** Statement period the parser observed. */
  period: { from: Date; to: Date };
  /** Opening balance at `period.from`. */
  openingBalance: Money;
  /** Closing balance at `period.to`. */
  closingBalance: Money;
  /**
   * Available balance at statement end (may differ from
   * `closingBalance` for pending-but-not-cleared items).
   */
  availableBalance?: Money;
  transactions: BankTransaction[];
  /** Provenance metadata — which format produced this statement. */
  source: BankStatementSource;
}

export interface BankStatementSource {
  /**
   * Format the statement was parsed from. The set is closed —
   * consumers can switch on it exhaustively. Add new variants here
   * (and bump the package minor version) when adding a new parser.
   */
  format: 'ofx' | 'qfx' | 'camt053' | 'mt940' | 'csv' | 'iif' | 'xero-csv' | 'plaid' | 'qbo';
  /** Format version — `'OFX 2.1.1'`, `'CAMT.053.001.08'`, etc. */
  version?: string;
  /** When the file was generated by the bank, if present. */
  generatedAt?: Date;
  /** Bank / vendor software fingerprint (e.g. OFX FI ORG). */
  softwareId?: string;
}

// ─── Bulk-import outcome ─────────────────────────────────────────────────

/**
 * Per-row failure during a bulk import. Consumers (revenue's `import()`)
 * collect these without aborting the batch.
 */
export interface BankImportRowError {
  externalId: string;
  reason: string;
  row?: BankTransaction;
}

/**
 * Outcome of a bulk import. Same shape ledger's `wireImport` reports
 * for symmetry.
 */
export interface BankImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  errors: BankImportRowError[];
  durationMs: number;
}
