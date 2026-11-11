import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabase.js', () => ({ supabase: { rpc } }));

import {
  deleteSynonym,
  listSynonyms,
  saveSynonym,
  SynonymError,
} from './synonyms.js';

function resolved({ data = null, error = null } = {}) {
  return { abortSignal: vi.fn().mockResolvedValue({ data, error }) };
}

describe('search synonym admin client', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('lists the vocabulary', async () => {
    rpc.mockReturnValue(
      resolved({
        data: [
          {
            term: 'pitaka',
            synonyms: ['wallet', 'purse'],
            enabled: true,
            updated_at: '2026-11-07T00:00:00Z',
          },
        ],
      }),
    );

    const rows = await listSynonyms({
      signal: new AbortController().signal,
    });

    expect(rpc).toHaveBeenCalledWith('list_search_synonyms');
    expect(rows[0].term).toBe('pitaka');
  });

  it('sends a term, synonyms and the enabled flag', async () => {
    rpc.mockReturnValue(resolved());

    await saveSynonym(
      {
        term: 'payong',
        synonyms: ['umbrella'],
        enabled: false,
        notes: 'weather item',
      },
      { signal: new AbortController().signal },
    );

    expect(rpc).toHaveBeenCalledWith('upsert_search_synonym', {
      p_term: 'payong',
      p_synonyms: ['umbrella'],
      p_enabled: false,
      p_notes: 'weather item',
    });
  });

  it('deletes by term', async () => {
    rpc.mockReturnValue(resolved());

    await deleteSynonym('payong', {
      signal: new AbortController().signal,
    });

    expect(rpc).toHaveBeenCalledWith('delete_search_synonym', {
      p_term: 'payong',
    });
  });

  it('surfaces an RPC failure as a SynonymError', async () => {
    rpc.mockReturnValue(
      resolved({ error: { message: 'Only the central admin can manage' } }),
    );

    const signal = new AbortController().signal;
    await expect(listSynonyms({ signal })).rejects.toBeInstanceOf(SynonymError);
    await expect(listSynonyms({ signal })).rejects.toMatchObject({
      code: 'db',
    });
  });
});
