/**
 * Whole-table CSV (@classytic/primitives/csv): `csvRecord` and `csvLines`, the
 * runtime-free half of the table-stream writer both FLOW apps copied (G-PHASEB-4a).
 */
import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvLines, csvRecord } from '../../src/serialization/csv.js';

const collect = async (lines: AsyncIterable<string>) => {
  let out = '';
  for await (const line of lines) out += line;
  return out;
};

describe('csvRecord', () => {
  it('escapes every cell, joins with commas, ends with CRLF', () => {
    expect(csvRecord(['S2', 'Omar, "Jr"', null, undefined, -1500, '=1+1'])).toBe(
      `S2,"Omar, ""Jr""",,,-1500,'=1+1\r\n`,
    );
    expect(csvRecord([])).toBe('\r\n');
  });
});

describe('csvLines', () => {
  it('async rows: BOM, quoting, formula neutralisation, empty cells', async () => {
    async function* rows() {
      yield ['S1', '=HYPERLINK("x")', 3] as const;
      yield ['S2', 'Omar, "Jr"', null] as const;
    }
    const body = await collect(
      csvLines({ header: ['Staff number', 'Name', 'Count'], rows: rows() }),
    );
    expect(CSV_BOM).toBe('﻿');
    expect(body.startsWith(CSV_BOM)).toBe(true);
    expect(body.slice(1).split('\r\n')).toEqual([
      'Staff number,Name,Count',
      `S1,"'=HYPERLINK(""x"")",3`,
      'S2,"Omar, ""Jr""",',
      '',
    ]);
  });

  it('header cells are neutralised too; plain iterables work; bom: false omits the mark', async () => {
    const body = await collect(
      csvLines({ header: ['@who', 'n'], rows: [['a', 1]] }, { bom: false }),
    );
    expect(body).toBe(`'@who,n\r\na,1\r\n`);
  });

  it('pulls rows as the consumer reads, not all up front', async () => {
    let produced = 0;
    async function* rows() {
      for (let i = 0; i < 5000; i++) {
        produced++;
        yield [`S${i}`, `Name ${i}`] as const;
      }
    }
    for await (const _line of csvLines({ header: ['a', 'b'], rows: rows() })) {
      if (produced >= 40) break;
    }
    expect(produced).toBe(40);
  });

  it('a failing row source rejects the consumer', async () => {
    async function* rows(): AsyncGenerator<readonly unknown[]> {
      yield ['ok'];
      throw new Error('cursor died');
    }
    await expect(collect(csvLines({ header: ['a'], rows: rows() }))).rejects.toThrow('cursor died');
  });
});
