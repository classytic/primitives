export type RoundingMode = 'half-even' | 'half-up';

/** Exact signed integer division rounded at the rational boundary. */
export function roundedDiv(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const twiceRemainder = remainder * 2n;
  const roundUp =
    twiceRemainder > denominator ||
    (twiceRemainder === denominator && (mode === 'half-up' || quotient % 2n !== 0n));
  const rounded = roundUp ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}
