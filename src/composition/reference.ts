/**
 * Minimal structural type for any ID object with a `.toString()` method. Does
 * NOT depend on `mongoose` — `Types.ObjectId` satisfies this shape
 * automatically, as do UUIDs from `uuid`, KSUIDs, ULIDs, etc.
 *
 * Use this wherever you'd otherwise import `Types.ObjectId` but don't want to
 * force a runtime dependency on Mongoose.
 */
export interface ObjectIdLike {
  toString(): string;
  toHexString?(): string;
}

/** A value that can be used as an identifier — raw string or object-id-like. */
export type IdLike = string | ObjectIdLike;

/** Coerce any {@link IdLike} to its canonical string form. */
export function idToString(id: IdLike): string {
  return typeof id === 'string' ? id : id.toString();
}

/**
 * Polymorphic external reference — points at a resource that may live in
 * another package, another service, or a different data store altogether.
 *
 * Paired with a host-implemented `SourceBridge` (see PACKAGE_RULES.md §7),
 * this pattern works across single-Mongo, microservice, and mixed-datastore
 * deployments.
 */
export interface ExternalRef {
  /** Opaque identifier — hex ObjectId, UUID, Stripe ID, or any other format. */
  sourceId: string;
  /** Logical model / type name — e.g. 'Order', 'StripeCharge', 'PostgresInvoice'. */
  sourceModel: string;
}

/** Typed reference to a document in a specific Mongo collection by ObjectId. */
export interface DocumentRef {
  collection: string;
  id: string;
}

export function isExternalRef(value: unknown): value is ExternalRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ExternalRef).sourceId === 'string' &&
    typeof (value as ExternalRef).sourceModel === 'string'
  );
}
