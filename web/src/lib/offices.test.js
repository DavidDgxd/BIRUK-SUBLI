import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('./supabase.js', () => ({ supabase: { from } }));

import { listOffices, publicOffices } from './offices.js';

function queryResult({ data = [], error = null } = {}) {
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    abortSignal: vi.fn().mockResolvedValue({ data, error }),
  };
  return query;
}

describe('listOffices', () => {
  beforeEach(() => {
    from.mockReset();
  });

  it('reads the public office directory, ordered by name', async () => {
    const office = { id: 'BCPIO', name: 'Baguio City Public Information Office' };
    const query = queryResult({ data: [office] });
    from.mockReturnValue(query);
    const signal = new AbortController().signal;

    await expect(listOffices({ signal })).resolves.toEqual([office]);

    expect(from).toHaveBeenCalledWith('offices');
    expect(query.select).toHaveBeenCalledWith(
      'id, name, address, counter_hours, phone_number, map_pin, status, auth_user_id, created_at',
    );
    expect(query.order).toHaveBeenCalledWith('name', { ascending: true });
    expect(query.abortSignal).toHaveBeenCalledWith(signal);
  });

  it('turns a read failure into an OfficeError', async () => {
    from.mockReturnValue(
      queryResult({ error: { message: 'permission denied' } }),
    );

    await expect(
      listOffices({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      name: 'OfficeError',
      code: 'db',
    });
  });
});

describe('publicOffices', () => {
  it('hides suspended offices from the public directory', () => {
    expect(
      publicOffices([
        { id: 'A', status: 'active' },
        { id: 'B', status: 'suspended' },
        { id: 'C' },
      ]),
    ).toEqual([
      { id: 'A', status: 'active' },
      { id: 'C' },
    ]);
  });
});
