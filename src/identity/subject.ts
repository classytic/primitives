/**
 * `SubjectRef` — WHO a record is about, polymorphically.
 *
 * The pairing `{ subjectModel, subjectRef }` appears across every package that
 * has to talk about a person without owning them: an attendance punch, an access
 * entitlement, a device credential, a loyalty balance. Each of those kernels
 * deliberately keeps the model a plain `string`, because attendance serves
 * employees, students and gym members and no kernel can know which.
 *
 * ## Why this is NOT `ExternalRef`
 *
 * `composition/reference.ts` already models `{ sourceId, sourceModel }` — the
 * identical SHAPE. They are kept apart because they answer different questions and
 * that difference is load-bearing:
 *
 * - `ExternalRef` — "this record CAME FROM there" (an Order, a Stripe charge, a
 *   Postgres invoice). Provenance. Used for reconciliation and cascades.
 * - `SubjectRef` — "this record is ABOUT them". Identity. Used for authorization
 *   and lookup.
 *
 * A grant carries both at once and they mean different things: `originModel:
 * 'Order'` (what paid) and `subjectModel: 'Party'` (who holds it). Collapsing them
 * into one type would make that sentence unsayable, and renaming the persisted
 * `subjectModel`/`subjectRef` fields to `sourceModel`/`sourceId` is the harmful
 * rename — a migration across many collections that buys nothing.
 *
 * ## Why a shared type at all
 *
 * The pairing spans SERVER and CLIENT. A server writes it when a membership grant
 * projects an entitlement; a web app writes it when staff bind a card. When the two
 * disagree nothing throws — the synchronizer matches on both fields, so it finds
 * ZERO rows, and freezing a membership silently stops touching the member's card.
 * That bug shipped: a UI hardcoded `'Customer'` against a server writing `'Party'`.
 * One shared type plus one shared constant per domain is the fix.
 */

/** A polymorphic reference to the subject a record is about. */
export interface SubjectRef {
  /** Logical model / type name — e.g. 'Party', 'Employee', 'Student', 'ApiKey'. */
  subjectModel: string;
  /** Opaque identifier of the subject within that model. */
  subjectRef: string;
}

/**
 * Build a `SubjectRef`, or `null` when the id is absent/blank.
 *
 * Returning null rather than a ref containing `"undefined"` or `""` is the whole
 * point: a malformed binding does not fail loudly, it silently matches nothing
 * forever — an entitlement nobody holds, a credential no revoke can find.
 */
export function makeSubjectRef(
  subjectModel: string,
  id: string | number | null | undefined,
): SubjectRef | null {
  const subjectRef = id === null || id === undefined ? '' : String(id).trim();
  const model = subjectModel.trim();
  if (subjectRef.length === 0 || model.length === 0) return null;
  return { subjectModel: model, subjectRef };
}

/**
 * The canonical `"Model:id"` string form.
 *
 * One formatter so log lines, dedupe keys and command payloads agree. Two
 * hand-rolled variants (`Party:1` vs `party/1`) look equivalent until one is used
 * as an idempotency key and the other as a lookup.
 */
export function formatSubjectRef(subject: SubjectRef): string {
  return `${subject.subjectModel}:${subject.subjectRef}`;
}

/** Exact equality on both halves — never on the id alone. */
export function subjectRefsEqual(a: SubjectRef | null, b: SubjectRef | null): boolean {
  if (!a || !b) return false;
  return a.subjectModel === b.subjectModel && a.subjectRef === b.subjectRef;
}

/** Structural guard for data crossing a wire. */
export function isSubjectRef(value: unknown): value is SubjectRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SubjectRef>;
  return (
    typeof v.subjectModel === 'string' &&
    v.subjectModel.length > 0 &&
    typeof v.subjectRef === 'string' &&
    v.subjectRef.length > 0
  );
}
