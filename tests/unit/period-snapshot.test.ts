import { describe, expect, it } from 'vitest';
import {
  type BalancePlan,
  runSnapshotReaderConformance,
} from '../../src/scheduling/period-snapshot.js';

type Row = { account: string; d: number; c: number };
const snap: BalancePlan = { watermark: new Date(0), tailFrom: new Date(1), tailEntries: 1, source: 'snapshot+tail' };
const scan: BalancePlan = { watermark: null, tailFrom: null, tailEntries: null, source: 'scan' };
const base = {
  asOf: [new Date('2026-01-31'), new Date('2026-02-28')],
  key: (r: Row) => r.account,
  amounts: (r: Row) => [r.d, r.c],
};

describe('runSnapshotReaderConformance', () => {
  it('passes when the snapshot path agrees with the scan at every instant', async () => {
    const rows = [{ account: 'cash', d: 500, c: 120 }];
    const out = await runSnapshotReaderConformance<Row>({
      ...base,
      read: async () => ({ rows, plan: snap }),
      scan: async () => ({ rows, plan: scan }),
      minSnapshotReads: 2,
    });
    expect(out).toEqual({ mismatches: [], snapshotReads: 2 });
  });

  it('reports a differing amount and a row only one side has', async () => {
    const out = await runSnapshotReaderConformance<Row>({
      ...base,
      read: async () => ({ rows: [{ account: 'cash', d: 500, c: 121 }], plan: snap }),
      scan: async () => ({
        rows: [
          { account: 'cash', d: 500, c: 120 },
          { account: 'bank', d: 7, c: 0 },
        ],
        plan: scan,
      }),
      minSnapshotReads: 1,
    });
    expect(out.mismatches.map((m) => m.key)).toEqual(['cash', 'bank', 'cash', 'bank']);
    expect(out.mismatches[1]).toMatchObject({ reader: null, scan: [7, 0] });
  });

  it('refuses a reader that never took the snapshot path', async () => {
    const rows = [{ account: 'cash', d: 1, c: 0 }];
    await expect(
      runSnapshotReaderConformance<Row>({
        ...base,
        read: async () => ({ rows, plan: scan }),
        scan: async () => ({ rows, plan: scan }),
        minSnapshotReads: 1,
      }),
    ).rejects.toThrow(/only 0 of 2 reads used a snapshot/);
  });
});
