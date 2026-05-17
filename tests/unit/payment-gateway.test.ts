/**
 * `payment-gateway` is a pure type module — no runtime functions to
 * test. The asserts here are compile-time-shaped: each test constructs
 * an instance of the type and pins the field set + the Money discipline.
 *
 * Hosts implementing payment providers (Stripe, Razorpay, SSLCommerz,
 * PayPal, bKash, Nagad, manual) all consume from this module, so drift
 * here cascades into every gateway integration. The pin matters.
 */

import { describe, expect, it } from 'vitest';
import type { Money } from '../../src/money/money.js';
import type {
  CreateIntentParams,
  PaymentIntent,
  PaymentResult,
  ProviderCapabilities,
  RefundResult,
  WebhookEvent,
} from '../../src/money/payment-gateway.js';

describe('CreateIntentParams shape', () => {
  it('amount is Money (number minor units)', () => {
    const params: CreateIntentParams = {
      amount: { amount: 19_99, currency: 'USD' },
    };
    const a: number = params.amount.amount;
    expect(a).toBe(1999);
    expect(typeof params.amount.amount).toBe('number');
  });

  it('accepts customerId, returnUrl, metadata as optional', () => {
    const params: CreateIntentParams = {
      amount: { amount: 5_000, currency: 'EUR' },
      customerId: 'cus_xyz',
      returnUrl: 'https://shop.example/checkout/return',
      metadata: { orderId: 'ord_123', planKey: 'pro-yearly' },
    };
    expect(params.customerId).toBe('cus_xyz');
    expect(params.returnUrl).toContain('checkout');
    expect(params.metadata?.orderId).toBe('ord_123');
  });

  it('index signature accepts gateway-specific keys (Stripe, SSLCommerz, bKash)', () => {
    // Stripe-style payment-method types
    const stripe: CreateIntentParams = {
      amount: { amount: 1_000, currency: 'USD' },
      payment_method_types: ['card', 'us_bank_account'],
    };
    // SSLCommerz tran_id
    const ssl: CreateIntentParams = {
      amount: { amount: 1_000, currency: 'BDT' },
      tran_id: 'tr_abc123',
    };
    // bKash intent
    const bkash: CreateIntentParams = {
      amount: { amount: 1_000, currency: 'BDT' },
      intent: 'sale',
    };
    expect(stripe['payment_method_types']).toEqual(['card', 'us_bank_account']);
    expect(ssl['tran_id']).toBe('tr_abc123');
    expect(bkash['intent']).toBe('sale');
  });
});

describe('PaymentIntent shape', () => {
  it('Stripe Checkout shape — sessionId + clientSecret', () => {
    const intent: PaymentIntent = {
      id: 'pi_3OqXyZ',
      provider: 'stripe',
      status: 'requires_action',
      amount: { amount: 50_00, currency: 'USD' },
      sessionId: 'cs_test_a1b2c3',
      paymentIntentId: 'pi_3OqXyZ',
      clientSecret: 'pi_3OqXyZ_secret_xyz',
    };
    expect(intent.provider).toBe('stripe');
    expect(intent.clientSecret).toBeTruthy();
  });

  it('SSLCommerz / PayPal shape — paymentUrl redirect', () => {
    const ssl: PaymentIntent = {
      id: 'tr_abc123',
      provider: 'sslcommerz',
      status: 'pending',
      amount: { amount: 1500_00, currency: 'BDT' },
      sessionId: 'cs_ssl_x1',
      paymentUrl: 'https://sandbox.sslcommerz.com/EasyCheckOut/cs_ssl_x1',
    };
    const paypal: PaymentIntent = {
      id: 'PAYPAL-ORDER-XYZ',
      provider: 'paypal',
      status: 'CREATED',
      amount: { amount: 99_99, currency: 'USD' },
      paymentUrl: 'https://www.paypal.com/checkoutnow?token=PAYPAL-ORDER-XYZ',
    };
    expect(ssl.paymentUrl).toContain('sslcommerz');
    expect(paypal.paymentUrl).toContain('paypal');
  });

  it('Manual provider shape — instructions, no API URLs', () => {
    const manual: PaymentIntent = {
      id: 'manual_2026_001',
      provider: 'manual',
      status: 'pending',
      amount: { amount: 25_000, currency: 'USD' },
      instructions: 'Wire transfer to A/c 12345678 at JPMorgan Chase. Reference: manual_2026_001.',
    };
    expect(manual.instructions).toContain('Wire transfer');
    expect(manual.sessionId).toBeUndefined();
    expect(manual.paymentUrl).toBeUndefined();
  });

  it('amount.amount carries through losslessly across all flows', () => {
    const expected = 1234567; // $12,345.67
    const intent: PaymentIntent = {
      id: 'a',
      provider: 'stripe',
      status: 'pending',
      amount: { amount: expected, currency: 'USD' },
    };
    const m: Money = intent.amount;
    expect(m.amount).toBe(expected);
  });
});

describe('PaymentResult shape', () => {
  it('status is closed enum: succeeded | failed | processing | requires_action', () => {
    const succeeded: PaymentResult = { id: 'a', provider: 'stripe', status: 'succeeded' };
    const failed: PaymentResult = { id: 'a', provider: 'stripe', status: 'failed' };
    const processing: PaymentResult = { id: 'a', provider: 'stripe', status: 'processing' };
    const action: PaymentResult = { id: 'a', provider: 'stripe', status: 'requires_action' };
    expect(succeeded.status).toBe('succeeded');
    expect(failed.status).toBe('failed');
    expect(processing.status).toBe('processing');
    expect(action.status).toBe('requires_action');
  });

  it('paidAt is Date; amount is Money when present', () => {
    const r: PaymentResult = {
      id: 'pi_3OqXyZ',
      provider: 'stripe',
      status: 'succeeded',
      amount: { amount: 50_00, currency: 'USD' },
      paidAt: new Date('2026-05-01T14:23:11Z'),
    };
    expect(r.paidAt).toBeInstanceOf(Date);
    expect(r.amount?.currency).toBe('USD');
  });
});

describe('RefundResult shape', () => {
  it('status is narrower than PaymentResult (no requires_action)', () => {
    const r: RefundResult = {
      id: 're_3OqXyZ',
      provider: 'stripe',
      status: 'succeeded',
      amount: { amount: 25_00, currency: 'USD' },
      refundedAt: new Date(),
      reason: 'customer_request',
    };
    expect(r.status).toBe('succeeded');
  });

  it('partial refunds carry reduced amount', () => {
    const partial: RefundResult = {
      id: 're_partial',
      provider: 'stripe',
      status: 'succeeded',
      amount: { amount: 10_00, currency: 'USD' }, // $10 of a $50 charge
      reason: 'damaged_item',
    };
    expect(partial.amount?.amount).toBe(1000);
  });
});

describe('WebhookEvent shape', () => {
  it('id is the dedup key — engine stamps this on Transaction.webhook.eventId', () => {
    const evt: WebhookEvent = {
      id: 'evt_1OXyzAbCd',
      provider: 'stripe',
      type: 'payment_intent.succeeded',
      data: { paymentIntentId: 'pi_3OqXyZ' },
      createdAt: new Date(),
    };
    expect(evt.id).toBeTruthy();
    expect(evt.data.paymentIntentId).toBe('pi_3OqXyZ');
  });

  it('routing fields support both sessionId-style and paymentIntentId-style flows', () => {
    const stripe: WebhookEvent = {
      id: 'evt_stripe',
      provider: 'stripe',
      type: 'payment_intent.succeeded',
      data: { paymentIntentId: 'pi_xyz' },
    };
    const ssl: WebhookEvent = {
      id: 'evt_ssl',
      provider: 'sslcommerz',
      type: 'payment.success',
      data: { sessionId: 'cs_ssl_x1', tran_id: 'tr_abc123' },
    };
    expect(stripe.data.paymentIntentId).toBeTruthy();
    expect(ssl.data.sessionId).toBeTruthy();
    expect(ssl.data['tran_id']).toBe('tr_abc123');
  });
});

describe('ProviderCapabilities matrix', () => {
  it('Stripe — full capabilities', () => {
    const cap: ProviderCapabilities = {
      supportsWebhooks: true,
      supportsRefunds: true,
      supportsPartialRefunds: true,
      requiresManualVerification: false,
    };
    expect(cap.supportsWebhooks && cap.supportsRefunds).toBe(true);
  });

  it('Manual — no webhooks, requires human verification', () => {
    const cap: ProviderCapabilities = {
      supportsWebhooks: false,
      supportsRefunds: true,
      supportsPartialRefunds: true,
      requiresManualVerification: true,
    };
    expect(cap.supportsWebhooks).toBe(false);
    expect(cap.requiresManualVerification).toBe(true);
  });

  it('Cash — no refunds online, manual verification', () => {
    const cap: ProviderCapabilities = {
      supportsWebhooks: false,
      supportsRefunds: false,
      supportsPartialRefunds: false,
      requiresManualVerification: true,
    };
    expect(cap.supportsRefunds).toBe(false);
  });
});
