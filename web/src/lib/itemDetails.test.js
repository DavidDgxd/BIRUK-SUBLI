import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

import { fetchPublicItem } from './itemDetails.js';

function resolvedRpc(data) {
  return { abortSignal: vi.fn().mockResolvedValue({ data, error: null }) };
}

describe('fetchPublicItem', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('returns a held item', async () => {
    const held = { id: 'item-1', status: 'held', title: 'Wallet' };
    rpc.mockReturnValue(resolvedRpc([held]));

    await expect(
      fetchPublicItem('11111111-1111-1111-1111-111111111111'),
    ).resolves.toEqual(held);
  });

  it('treats a released row as not found', async () => {
    rpc.mockReturnValue(
      resolvedRpc([{ id: 'item-1', status: 'released', title: 'Wallet' }]),
    );

    await expect(
      fetchPublicItem('11111111-1111-1111-1111-111111111111'),
    ).rejects.toMatchObject({ name: 'ItemDetailError', code: 'not-found' });
  });

  it('rejects a malformed id without calling the RPC', async () => {
    await expect(fetchPublicItem('12')).rejects.toMatchObject({
      name: 'ItemDetailError',
      code: 'not-found',
    });

    expect(rpc).not.toHaveBeenCalled();
  });
});
