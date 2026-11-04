import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

import { listOfficeHeldCounts } from './usageReport.js';

function resolvedRpc({ data = [], error = null } = {}) {
  return { abortSignal: vi.fn().mockResolvedValue({ data, error }) };
}

describe('listOfficeHeldCounts', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('maps each office to its current held count', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        data: [
          { office_id: 'BCPIO', items_currently_held: 3 },
          { office_id: 'CITY_HALL_INFO', items_currently_held: '0' },
        ],
      }),
    );
    const signal = new AbortController().signal;

    await expect(listOfficeHeldCounts({ signal })).resolves.toEqual(
      new Map([
        ['BCPIO', 3],
        ['CITY_HALL_INFO', 0],
      ]),
    );

    expect(rpc).toHaveBeenCalledWith('get_usage_report', {
      p_start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      p_end_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      p_office_id: null,
    });
    const args = rpc.mock.calls[0][1];
    expect(args.p_end_date).toBe(args.p_start_date);
  });

  it('marks a non-admin refusal as forbidden', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        error: { code: '42501', message: 'Only the central admin can view it.' },
      }),
    );

    await expect(
      listOfficeHeldCounts({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      name: 'UsageReportError',
      code: 'forbidden',
    });
  });

  it('surfaces any other read failure', async () => {
    rpc.mockReturnValue(
      resolvedRpc({ error: { code: 'XX000', message: 'database unavailable' } }),
    );

    await expect(
      listOfficeHeldCounts({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      name: 'UsageReportError',
      code: 'db',
    });
  });
});
