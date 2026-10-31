import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('./supabase.js', () => ({ supabase: { from } }));

import {
  FoundReportsError,
  intakePrefillFromReport,
  listPendingFoundReports,
} from './foundReports.js';

function queryResult({ data = [], error = null } = {}) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    abortSignal: vi.fn().mockResolvedValue({ data, error }),
  };
  return query;
}

describe('listPendingFoundReports', () => {
  beforeEach(() => {
    from.mockReset();
  });

  it('reads only pending reports, oldest first', async () => {
    const query = queryResult({ data: [{ id: 'report-1' }] });
    from.mockReturnValue(query);
    const signal = new AbortController().signal;

    await expect(listPendingFoundReports({ signal })).resolves.toEqual([
      { id: 'report-1' },
    ]);

    expect(from).toHaveBeenCalledWith('found_reports');
    expect(query.eq).toHaveBeenCalledWith('status', 'pending');
    expect(query.order).toHaveBeenNthCalledWith(1, 'created_at', {
      ascending: true,
    });
    expect(query.order).toHaveBeenNthCalledWith(2, 'ref_code', {
      ascending: true,
    });
    expect(query.abortSignal).toHaveBeenCalledWith(signal);
  });

  it('surfaces a read failure', async () => {
    from.mockReturnValue(
      queryResult({ error: { message: 'permission denied' } }),
    );

    await expect(
      listPendingFoundReports({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      name: 'FoundReportsError',
      code: 'db',
    });
  });
});

describe('intakePrefillFromReport', () => {
  it('copies the note, contact, photo and reference into intake fields', () => {
    const prefill = intakePrefillFromReport({
      id: 'report-1',
      ref_code: 'FR-0101',
      short_note: '  Black folding umbrella with a wooden handle  ',
      finder_contact: ' 0917 000 0000 ',
      image_url: 'https://example.test/umbrella.webp',
    });

    expect(prefill).toEqual({
      title: 'Black folding umbrella with a wooden handle',
      description: 'Black folding umbrella with a wooden handle',
      finderContact: '0917 000 0000',
      photoUrl: 'https://example.test/umbrella.webp',
      refCode: 'FR-0101',
      reportId: 'report-1',
    });
  });

  it('keeps a long note within the intake title limit', () => {
    const prefill = intakePrefillFromReport({
      short_note: 'word '.repeat(60),
    });

    expect(prefill.title.length).toBeLessThanOrEqual(120);
    expect(prefill.title.endsWith('…')).toBe(true);
    expect(prefill.description.length).toBeGreaterThan(120);
  });

  it('is a FoundReportsError when the data layer fails', () => {
    expect(new FoundReportsError('db', 'no')).toMatchObject({
      name: 'FoundReportsError',
      code: 'db',
    });
  });
});
