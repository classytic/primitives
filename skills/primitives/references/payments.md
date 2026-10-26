# Payments and bank data (shapes and vocabularies)

Subpaths: `/payment-gateway`, `/payment-method-kind`, `/payment-allocation-status`, `/payment-events`, `/bank-transaction`. Mostly types and constants; the engine, repositories and providers live in other packages. Amounts are `Money` from `/money`.

## /payment-method-kind
`PAYMENT_METHOD_KIND` constants: `card`, `bank_transfer`, `instant_bank_transfer`, `direct_debit`, `wallet`, `mobile_money`, `bnpl`, `gift_card`, `cash`, `cheque`, `cryptocurrency`, `manual`, `other`. `isPaymentMethodKind(v)` guards. A kind is the universal category; a host-specific `methodCode` (such as a provider name) is a separate string. Treat unknown values as `other`.

## /payment-allocation-status
Two independent dimensions on a payment leg.
- `PAYMENT_ALLOCATION_STATUS`: `unallocated`, `partial`, `allocated`, `over_allocated`; `isPaymentAllocationStatus`.
- `RECONCILIATION_STATUS`: `unreconciled`, `matched`, `manual`, `disputed`; `isReconciliationStatus`.

## /payment-events
Wire payloads for the `DomainEvent` envelope (see `references/events.md`). `PAYMENT_EVENT_TYPE` keys: `INITIATED`, `SUCCEEDED`, `FAILED`, `REFUNDED`, `REVERSED`, `RECONCILED`, `AUTHORIZED`, `CAPTURED`, `AUTH_VOIDED`, `DISPUTED`, `DISPUTE_WON`, `DISPUTE_LOST`, `SETTLED`, `UNKNOWN` (values like `payment.succeeded`).
- Each payload has a literal `eventType` discriminant, `paymentId`, `amount: Money`, `methodKind`, `occurredAt`.
- `isPaymentEvent(type, payload)` narrows a payload to its typed shape. `isFundsReceived(payload)` is true only for `succeeded` and `captured`.
- `UNKNOWN` means the provider command had no observable outcome (timeout, abort). Never map it to failed: a retry can double charge.

```ts
import { money } from "@classytic/primitives/money";
import { isFundsReceived, isPaymentEvent, PAYMENT_EVENT_TYPE, type PaymentEventPayload } from "@classytic/primitives/payment-events";

const payload: PaymentEventPayload = {
  eventType: PAYMENT_EVENT_TYPE.SUCCEEDED,
  paymentId: "pay_1",
  providerCode: "manual",
  amount: money(2500, "USD"),
  methodKind: "cash",
  occurredAt: new Date("2026-01-01T00:00:00Z"),
};
console.log(isPaymentEvent(PAYMENT_EVENT_TYPE.SUCCEEDED, payload), isFundsReceived(payload));
```

## /payment-gateway
Data shapes a provider speaks to a payment engine.
- `PaymentProviderPort`: `createIntent(params, command)`, `verifyPayment`, `getStatus`, `refund(paymentId, amount, command, options)`, `handleWebhook`, `verifyWebhookSignature`, `getCapabilities()`; optional `getRefundStatus`, `wantsRawBody`.
- `PaymentCommandContext` requires `idempotencyKey`, `requestId`, `merchantReference`; optional `organizationId`, `signal`.
- `ProviderCommandResult<T>` is three-valued: `confirmed`, `declined` (with `PaymentDecline`: `reason`, `retryable`), `unknown` (with `ProviderUnknownCause`).
- Also: `ProviderCapabilities`, `CreateIntentParams`, `ProviderIntent`, `PaymentResult`, `RefundResult`, `WebhookEvent`, `DefaultCurrencyAware`, `RefundStatusQuery`.
- `ProviderStatusUnavailableError(providerName)`: throw when a provider cannot answer a status query.

## /bank-transaction
Bank-feed shapes shared by statement parsers and importers: `BankTransaction`, `BankStatement`, `BankAccount`, `BankCounterparty`, `BankStatementSource`, `BankImportReport`, `BankImportRowError`.
- `BankTransaction.amount` is signed Money: positive is inflow to the account holder, negative is outflow.
- `externalId` is the dedupe key; `supersedesExternalId` replaces a pending row with its posted one; `raw` keeps the source row.
- `BankStatement.source.format`: `ofx`, `qfx`, `camt053`, `mt940`, `csv`, `iif`, `xero-csv`, `plaid`, `qbo`.

## Cash destination
`CASH_DESTINATIONS` (`cash`, `petty_cash`), `isCashDestination`, `cashDestinationLabel` come from `/money`. They name where received cash landed as an intent, never as a chart-of-accounts code.
