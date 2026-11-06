import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('./supabase.js', () => ({ supabase: { from } }));

import {
  listOfficeOptions,
  listOffices,
  listPublicOffices,
} from './offices.js';

function queryResult({ data = [], error = null } = {}) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    abortSignal: vi.fn().mockResolvedValue({ data, error }),
  };
  return query;
}

describe('listPublicOffices', () => {
  beforeEach(() => {
    from.mockReset();
  });

  it('selects only public fields and filters active offices in the database', async () => {
    const office = {
      id: 'BCPIO',
      name: 'Baguio City Public Information Office',
      address: 'City Hall, Baguio City',
      counter_hours: '8:00 AM - 5:00 PM',
    };
    const query = queryResult({ data: [office] });
    from.mockReturnValue(query);
    const signal = new AbortController().signal;

    await expect(listPublicOffices({ signal })).resolves.toEqual([office]);

    expect(from).toHaveBeenCalledWith('offices');
    expect(query.select).toHaveBeenCalledWith(
      'id, name, address, counter_hours',
    );
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(query.order).toHaveBeenCalledWith('name', { ascending: true });
    expect(query.abortSignal).toHaveBeenCalledWith(signal);
  });

  it('turns a read failure into an OfficeError', async () => {
    from.mockReturnValue(
      queryResult({ error: { message: 'permission denied' } }),
    );

    await expect(
      listPublicOffices({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      name: 'OfficeError',
      code: 'db',
    });
  });
});

describe('listOfficeOptions', () => {
  beforeEach(() => {
    from.mockReset();
  });

  it('selects only the picker fields and filters active offices in the database', async () => {
    const office = {
      id: 'BCPIO',
      name: 'Baguio City Public Information Office',
    };
    const query = queryResult({ data: [office] });
    from.mockReturnValue(query);
    const signal = new AbortController().signal;

    await expect(listOfficeOptions({ signal })).resolves.toEqual([office]);

    expect(from).toHaveBeenCalledWith('offices');
    expect(query.select).toHaveBeenCalledWith('id, name');
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(query.order).toHaveBeenCalledWith('name', { ascending: true });
    expect(query.abortSignal).toHaveBeenCalledWith(signal);
  });

  it('turns a read failure into an OfficeError', async () => {
    from.mockReturnValue(
      queryResult({ error: { message: 'permission denied' } }),
    );

    await expect(
      listOfficeOptions({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      name: 'OfficeError',
      code: 'db',
    });
  });
});

describe('listOffices', () => {
  beforeEach(() => {
    from.mockReset();
  });

  it('reads the public office directory, ordered by name', async () => {
    const office = {
      id: 'BCPIO',
      name: 'Baguio City Public Information Office',
    };
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
