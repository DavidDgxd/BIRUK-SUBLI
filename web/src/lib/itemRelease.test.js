import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

import { releaseItemAtCounter } from './itemRelease.js';

function resolvedRpc(error = null) {
  return { abortSignal: vi.fn().mockResolvedValue({ error }) };
}

const baseRelease = {
  itemId: ' 11111111-1111-1111-1111-111111111111 ',
  officeId: ' BCPIO ',
  claimantName: '  Maria Santos  ',
  claimantIdRef: ' UMID-4921 ',
  releaseNotes: '  Authorization letter on file.  ',
  signal: new AbortController().signal,
};

describe('releaseItemAtCounter', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('sends trimmed claimant details to the release RPC', async () => {
    rpc.mockReturnValue(resolvedRpc());

    await expect(releaseItemAtCounter(baseRelease)).resolves.toEqual({
      claimantName: 'Maria Santos',
      claimantIdRef: 'UMID-4921',
    });

    expect(rpc).toHaveBeenCalledWith('release_item_at_counter', {
      p_item_id: '11111111-1111-1111-1111-111111111111',
      p_releasing_office_id: 'BCPIO',
      p_claimant_name: 'Maria Santos',
      p_claimant_id_ref: 'UMID-4921',
      p_release_notes: 'Authorization letter on file.',
    });
  });

  it.each([
    ['item id', { itemId: '   ' }],
    ['releasing office', { officeId: '' }],
    ['claimant name', { claimantName: '   ' }],
    ['ID reference', { claimantIdRef: '' }],
  ])('rejects a blank %s before calling the RPC', async (_label, change) => {
    await expect(
      releaseItemAtCounter({ ...baseRelease, ...change }),
    ).rejects.toMatchObject({ name: 'ItemReleaseError', code: 'validation' });

    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps optional release notes null when left blank', async () => {
    rpc.mockReturnValue(resolvedRpc());

    await releaseItemAtCounter({ ...baseRelease, releaseNotes: '   ' });

    expect(rpc).toHaveBeenCalledWith(
      'release_item_at_counter',
      expect.objectContaining({ p_release_notes: null }),
    );
  });

  it.each([
    ['42501', 'forbidden'],
    ['55000', 'duplicate'],
    ['22023', 'validation'],
    ['XX000', 'db'],
  ])('maps SQLSTATE %s to %s', async (code, expected) => {
    rpc.mockReturnValue(resolvedRpc({ code, message: 'release failed' }));

    await expect(releaseItemAtCounter(baseRelease)).rejects.toMatchObject({
      name: 'ItemReleaseError',
      code: expected,
    });
  });

  it('recognises a duplicate message when the driver omits SQLSTATE', async () => {
    rpc.mockReturnValue(
      resolvedRpc({
        message:
          'Item 11111111-1111-1111-1111-111111111111 has already been released or is no longer held.',
      }),
    );

    await expect(releaseItemAtCounter(baseRelease)).rejects.toMatchObject({
      code: 'duplicate',
    });
  });
});
