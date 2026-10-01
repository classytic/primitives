import { describe, expect, it } from 'vitest';
import { diffEventSchema } from '../../src/events/events.js';

/** JSON Schemas in the exact shape `z.toJSONSchema` emits (primitives stays zod-free). */
type Node = Record<string, unknown>;
const obj = (properties: Record<string, Node>, required: string[]): Node => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const str: Node = { type: 'string' };
const num: Node = { type: 'number' };
const int: Node = { type: 'integer' };
const oneOfEnum = (...values: string[]): Node => ({ type: 'string', enum: values });

const base = obj({ id: str, amount: num, note: str, status: oneOfEnum('a', 'b') }, [
  'id',
  'amount',
  'status',
]);
const withProps = (patch: Record<string, Node>, required = ['id', 'amount', 'status']) =>
  obj({ ...(base.properties as Record<string, Node>), ...patch }, required);
const breaking = (a: Node, b: Node) =>
  diffEventSchema(a, b)
    .filter((c) => c.breaking)
    .map((c) => `${c.path}:${c.kind}`);

describe('diffEventSchema — forward compatibility (old consumers, new producer)', () => {
  it('adding a field — required or optional — never breaks a consumer', () => {
    expect(
      breaking(base, withProps({ extra: str, maybe: num }, ['id', 'amount', 'status', 'extra'])),
    ).toEqual([]);
  });

  it('removing a REQUIRED field breaks; removing an optional one does not', () => {
    expect(
      breaking(base, obj({ id: str, note: str, status: oneOfEnum('a', 'b') }, ['id', 'status'])),
    ).toEqual(['amount:removed']);
    expect(
      breaking(
        base,
        obj({ id: str, amount: num, status: oneOfEnum('a', 'b') }, ['id', 'amount', 'status']),
      ),
    ).toEqual([]);
  });

  it('required → optional breaks; optional → required does not', () => {
    expect(breaking(base, withProps({}, ['id', 'status']))).toEqual(['amount:now-optional']);
    expect(breaking(base, withProps({}, ['id', 'amount', 'status', 'note']))).toEqual([]);
  });

  it('a widening type breaks (incl. becoming nullable); narrowing does not; integer is a number', () => {
    expect(breaking(base, withProps({ id: { type: ['string', 'number'] } }))).toEqual([
      'id:type-widened',
    ]);
    expect(breaking(base, withProps({ id: { type: ['string', 'null'] } }))).toEqual([
      'id:type-widened',
    ]);
    expect(breaking(base, withProps({ amount: int }))).toEqual([]);
  });

  it('an enum that gains a value breaks; losing one does not; dropping the enum breaks', () => {
    expect(breaking(base, withProps({ status: oneOfEnum('a', 'b', 'c') }))).toEqual([
      'status:values-widened',
    ]);
    expect(breaking(base, withProps({ status: oneOfEnum('a') }))).toEqual([]);
    expect(breaking(base, withProps({ status: str }))).toEqual(['status:values-widened']);
  });

  it('recurses into nested objects, array items and record values', () => {
    const a = obj(
      {
        lines: { type: 'array', items: obj({ qty: num }, ['qty']) },
        byMethod: { type: 'object', propertyNames: str, additionalProperties: num },
      },
      ['lines', 'byMethod'],
    );
    const b = obj(
      {
        lines: { type: 'array', items: obj({ qty: str }, ['qty']) },
        byMethod: { type: 'object', propertyNames: str, additionalProperties: str },
      },
      ['lines', 'byMethod'],
    );
    expect(breaking(a, b)).toEqual(['lines[].qty:type-widened', 'byMethod{}:type-widened']);
  });

  it('identical schemas have no changes', () => {
    expect(diffEventSchema(base, base)).toEqual([]);
  });
});
