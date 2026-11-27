import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('./supabase.js', () => ({ supabase: { from } }));

import {
  fetchCashHolding,
  finderRewardOnOwnerClaim,
  formatPeso,
  listCashReminders,
  withOwnerClaimRewardNote,
} from './cashReminders.js';

function chain(result) {
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(() => query),
    abortSignal: vi.fn(() => query),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

describe('listCashReminders', () => {
  beforeEach(() => from.mockReset());

  it('reads the reminders view, soonest reward date first', async () => {
    const rows = [{ id: 'a', reminder_type: 'due' }];
    const query = chain({ data: rows, error: null });
    from.mockReturnValue(query);
    const signal = new AbortController().signal;

    await expect(listCashReminders({ signal })).resolves.toEqual(rows);

    expect(from).toHaveBeenCalledWith('staff_reminders_view');
    const columns = query.select.mock.calls[0][0];
    for (const column of [
      'reminder_type',
      'reward_date',
      'finder_name',
      'finder_contact',
    ]) {
      expect(columns).toContain(column);
    }
    expect(query.order).toHaveBeenNthCalledWith(1, 'reward_date', {
      ascending: true,
    });
    expect(query.abortSignal).toHaveBeenCalledWith(signal);
  });

  it('returns an empty list when the view has no rows', async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    await expect(listCashReminders()).resolves.toEqual([]);
  });

  it('wraps a database error', async () => {
    from.mockReturnValue(chain({ data: null, error: { message: 'boom' } }));
    await expect(listCashReminders()).rejects.toMatchObject({
      name: 'CashRemindersError',
      code: 'db',
    });
  });
});

describe('fetchCashHolding', () => {
  beforeEach(() => from.mockReset());

  it('reads is_cash and the amount for one item', async () => {
    const query = chain({
      data: { is_cash: true, cash_amount: '1500.00' },
      error: null,
    });
    from.mockReturnValue(query);

    await expect(fetchCashHolding('item-1')).resolves.toEqual({
      isCash: true,
      cashAmount: 1500,
    });
    expect(from).toHaveBeenCalledWith('items');
    expect(query.select).toHaveBeenCalledWith('is_cash, cash_amount');
    expect(query.eq).toHaveBeenCalledWith('id', 'item-1');
  });

  it('treats a missing row as not cash', async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    await expect(fetchCashHolding('item-1')).resolves.toEqual({
      isCash: false,
      cashAmount: null,
    });
  });
});

describe('finderRewardOnOwnerClaim', () => {
  it.each([
    [1500, 150],
    [999.99, 100],
    [12.34, 1.23],
  ])('one-tenth of %s is %s', (amount, reward) => {
    expect(finderRewardOnOwnerClaim(amount)).toBe(reward);
  });

  it.each([null, 0, -5, 'abc'])('has no reward for %s', (amount) => {
    expect(finderRewardOnOwnerClaim(amount)).toBeNull();
  });
});

describe('formatPeso', () => {
  it('formats pesos', () => {
    expect(formatPeso(1500)).toMatch(/1,500\.00/);
  });

  it('returns null for no amount', () => {
    expect(formatPeso(null)).toBeNull();
  });
});

describe('withOwnerClaimRewardNote', () => {
  it('records the one-tenth reward when there are no notes', () => {
    const note = withOwnerClaimRewardNote('', 1500);
    expect(note).toMatch(/^Cash released to owner: owner gives the finder /);
    expect(note).toMatch(/150\.00, one-tenth of .*1,500\.00/);
    expect(note).toContain('(Civil Code Art. 720).');
  });

  it('keeps the officer notes and adds the reward on a new line', () => {
    const note = withOwnerClaimRewardNote('  Letter on file.  ', 800);
    const lines = note.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Letter on file.');
    expect(lines[1]).toContain('Civil Code Art. 720');
  });

  it.each([
    'Finder paid per Civil Code Art. 720.',
    'finder reward given per art. 720',
    'ART 720 reward settled',
    'Art.720 done',
    'Owner paid finder under Article 720.',
  ])('leaves "%s" unchanged', (typed) => {
    expect(withOwnerClaimRewardNote(typed, 800)).toBe(typed);
  });

  it('does not mistake other numbers for Art. 720', () => {
    expect(withOwnerClaimRewardNote('Receipt art 7200', 800)).toContain(
      '\nCash released to owner:',
    );
  });

  it('still records the rule when the amount is unknown', () => {
    expect(withOwnerClaimRewardNote(null, null)).toBe(
      'Cash released to owner: owner gives the finder one-tenth of the amount (Civil Code Art. 720).',
    );
  });
});
