/**
 * `bank-transaction` is a pure type module — no runtime functions to
 * unit-test. The asserts here are compile-time-shaped: each test
 * constructs an instance of the type and pins the field set + the
 * Money discipline (positive = inflow). If any consumer-visible field
 * is renamed or its type widened, the tests break.
 *
 * fin-io and revenue both consume this shape directly; drift here
 * cascades into both packages, so the pin matters.
 */

import { describe, expect, it } from 'vitest';
import type {
  BankAccount,
  BankCounterparty,
  BankImportReport,
  BankImportRowError,
  BankStatement,
  BankStatementSource,
  BankTransaction,
} from '../../src/money/bank-transaction.js';
import type { Money } from '../../src/money/money.js';

describe('BankTransaction shape', () => {
  it('uses Money (number minor units) — not bigint, not float', () => {
    const txn: BankTransaction = {
      externalId: 'FIT_001',
      postedDate: new Date('2026-05-01'),
      amount: { amount: 19_99, currency: 'USD' }, // $19.99
      description: 'COFFEE SHOP',
    };
    // Compile-time: amount is number, not bigint.
    const a: number = txn.amount.amount;
    expect(a).toBe(1999);
    expect(typeof txn.amount.amount).toBe('number');
  });

  it('signed amount: positive = inflow, negative = outflow', () => {
    const inflow: BankTransaction = {
      externalId: 'IN',
      postedDate: new Date(),
      amount: { amount: 10_000, currency: 'USD' },
      description: 'PAYROLL',
    };
    const outflow: BankTransaction = {
      externalId: 'OUT',
      postedDate: new Date(),
      amount: { amount: -2_500, currency: 'USD' },
      description: 'AWS BILLING',
    };
    expect(inflow.amount.amount).toBeGreaterThan(0);
    expect(outflow.amount.amount).toBeLessThan(0);
  });

  it('externalId is required (compile-time enforced)', () => {
    // Missing externalId would be a TS error — round-trip the field
    // through a build-and-read to pin the contract at runtime too.
    const txn: BankTransaction = {
      externalId: 'FIT_001',
      postedDate: new Date(),
      amount: { amount: 100, currency: 'USD' },
      description: 'd',
    };
    expect(txn.externalId).toBe('FIT_001');
  });

  it('counterparty fields are all optional and pluggable independently', () => {
    const empty: BankCounterparty = {};
    const named: BankCounterparty = { name: 'ACME' };
    const sepa: BankCounterparty = {
      name: 'ACME GmbH',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
    };
    const us: BankCounterparty = {
      name: 'ACME LLC',
      accountNumber: '12345',
      routingNumber: '021000021',
    };
    expect(Object.keys(empty)).toHaveLength(0);
    expect(named.name).toBe('ACME');
    expect(sepa.iban).toBe('DE89370400440532013000');
    expect(us.routingNumber).toBe('021000021');
  });

  it('balanceAfter is Money — same precision discipline as amount', () => {
    const txn: BankTransaction = {
      externalId: 'a',
      postedDate: new Date(),
      amount: { amount: 100, currency: 'USD' },
      description: 'd',
      balanceAfter: { amount: 50_000, currency: 'USD' },
    };
    const m: Money | undefined = txn.balanceAfter;
    expect(m?.amount).toBe(50_000);
  });

  it('sourceAccountId carries the vendor account for multi-account routing', () => {
    // Sync feeds (Plaid/Xero) span multiple accounts per batch — each row
    // names its own source account.
    const fromAcctA: BankTransaction = {
      externalId: 'plaid-1',
      postedDate: new Date(),
      amount: { amount: -2_500, currency: 'USD' },
      description: 'COFFEE',
      sourceAccountId: 'plaid-acct-AAA',
    };
    const fromAcctB: BankTransaction = {
      externalId: 'plaid-2',
      postedDate: new Date(),
      amount: { amount: 10_000, currency: 'USD' },
      description: 'PAYROLL',
      sourceAccountId: 'plaid-acct-BBB',
    };
    expect(fromAcctA.sourceAccountId).not.toBe(fromAcctB.sourceAccountId);
    // Statement-format rows are single-account → leave it undefined.
    const ofxRow: BankTransaction = {
      externalId: 'ofx-1',
      postedDate: new Date(),
      amount: { amount: 100, currency: 'USD' },
      description: 'd',
    };
    expect(ofxRow.sourceAccountId).toBeUndefined();
  });

  it('pending + supersedesExternalId model the real-time-feed lifecycle', () => {
    // A provisional pending row (Plaid `pending: true`).
    const pending: BankTransaction = {
      externalId: 'plaid-pending-1',
      postedDate: new Date(),
      amount: { amount: -2_500, currency: 'USD' },
      description: 'AMZN MKTP (pending)',
      pending: true,
    };
    // The posted row that later supersedes it (different externalId, back-ref).
    const posted: BankTransaction = {
      externalId: 'plaid-posted-9',
      postedDate: new Date(),
      amount: { amount: -2_500, currency: 'USD' },
      description: 'AMZN MKTP',
      pending: false,
      supersedesExternalId: 'plaid-pending-1',
    };
    expect(pending.pending).toBe(true);
    // Both omit fine (statement formats never set them).
    const settled: BankTransaction = {
      externalId: 'ofx-1',
      postedDate: new Date(),
      amount: { amount: 100, currency: 'USD' },
      description: 'd',
    };
    expect(settled.pending).toBeUndefined();
    expect(settled.supersedesExternalId).toBeUndefined();
    // The back-pointer links posted → the pending row it replaces.
    expect(posted.supersedesExternalId).toBe(pending.externalId);
  });
});

describe('BankAccount shape', () => {
  it('only `currency` is required — every other field is optional', () => {
    const minimal: BankAccount = { currency: 'USD' };
    expect(minimal.currency).toBe('USD');
    // Compile-time: nothing else mandatory.
  });

  it('IBAN-based EU accounts populate iban+bankName, no accountNumber', () => {
    const eu: BankAccount = {
      iban: 'DE89370400440532013000',
      bankName: 'Commerzbank',
      currency: 'EUR',
    };
    expect(eu.iban).toBeTruthy();
    expect(eu.accountNumber).toBeUndefined();
  });

  it('US accounts populate accountNumber+bankCode, no iban', () => {
    const us: BankAccount = {
      accountNumber: '0123456789',
      bankCode: '021000021',
      bankName: 'JPMorgan Chase',
      currency: 'USD',
      accountType: 'CHECKING',
    };
    expect(us.iban).toBeUndefined();
    expect(us.accountType).toBe('CHECKING');
  });
});

describe('BankStatement shape', () => {
  it('balances are Money; transactions array is populated', () => {
    const stmt: BankStatement = {
      account: { currency: 'USD' },
      period: { from: new Date('2026-05-01'), to: new Date('2026-05-31') },
      openingBalance: { amount: 100_000, currency: 'USD' },
      closingBalance: { amount: 125_000, currency: 'USD' },
      transactions: [
        {
          externalId: 'a',
          postedDate: new Date('2026-05-15'),
          amount: { amount: 25_000, currency: 'USD' },
          description: 'PAYROLL',
        },
      ],
      source: { format: 'ofx', version: 'OFX 2.1.1' },
    };
    expect(stmt.transactions).toHaveLength(1);
    expect(stmt.openingBalance.currency).toBe(stmt.closingBalance.currency);
  });

  it('source.format is closed — every fin-io parser hits one of these', () => {
    const formats: BankStatementSource['format'][] = [
      'ofx',
      'qfx',
      'camt053',
      'mt940',
      'csv',
      'iif',
      'xero-csv',
      'plaid',
      'qbo',
    ];
    for (const f of formats) {
      const src: BankStatementSource = { format: f };
      expect(src.format).toBe(f);
    }
  });
});

describe('BankImportReport / BankImportRowError', () => {
  it('inserted + updated + skipped sum to total rows attempted', () => {
    const errors: BankImportRowError[] = [{ externalId: 'BAD_1', reason: 'invalid_amount' }];
    const report: BankImportReport = {
      inserted: 8,
      updated: 1,
      skipped: 1,
      errors,
      durationMs: 142,
    };
    expect(report.inserted + report.updated + report.skipped).toBe(10);
    expect(report.errors).toHaveLength(1);
  });
});
