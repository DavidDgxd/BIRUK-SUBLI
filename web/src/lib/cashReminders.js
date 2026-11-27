import { supabase } from './supabase.js';

/** code: 'db' */
export class CashRemindersError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CashRemindersError';
    this.code = code;
  }
}

/**
 * Held cash at the signed-in office that is due, or due within 14 days, for
 * the finder payout (US-28). staff_reminders_view does the scoping: it joins
 * the session's own active office and judges the date by Asia/Manila, so an
 * item is listed once, as either 'due' or 'approaching'.
 */
export async function listCashReminders({ signal } = {}) {
  let query = supabase
    .from('staff_reminders_view')
    .select(
      'id, ref_code, title, reminder_type, reward_date, days_until_reward, cash_amount, finder_name, finder_contact',
    )
    .order('reward_date', { ascending: true })
    .order('ref_code', { ascending: true });

  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new CashRemindersError('db', error.message);

  return data ?? [];
}

/**
 * Whether one item is cash, and how much, for the release form. The public
 * detail projection deliberately leaves the amount out, so the counter reads
 * it from the items table, which only staff sessions can select.
 */
export async function fetchCashHolding(itemId, signal) {
  let query = supabase
    .from('items')
    .select('is_cash, cash_amount')
    .eq('id', itemId)
    .maybeSingle();

  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new CashRemindersError('db', error.message);

  return {
    isCash: data?.is_cash === true,
    cashAmount: data?.cash_amount == null ? null : Number(data.cash_amount),
  };
}

/**
 * The reward the owner gives the finder when claiming cash (Civil Code
 * Art. 720): one-tenth of the amount, rounded to the centavo.
 */
export function finderRewardOnOwnerClaim(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10) / 100;
}

export const ART_720_MARKER = 'Civil Code Art. 720';

/**
 * Release notes for cash handed to its owner, with the Art. 720 finder reward
 * recorded. The line goes through the existing p_release_notes parameter, so
 * the release RPC is unchanged (US-34 owns the full payout record). Notes that
 * already mention Art. 720 are left as the officer wrote them.
 */
export function withOwnerClaimRewardNote(notes, amount) {
  const clean = (notes ?? '').trim();
  if (clean.includes(ART_720_MARKER)) return clean;

  const reward = formatPeso(finderRewardOnOwnerClaim(amount));
  const total = formatPeso(amount);
  const line = reward
    ? `Cash released to owner: owner gives the finder ${reward}, one-tenth of ${total} (${ART_720_MARKER}).`
    : `Cash released to owner: owner gives the finder one-tenth of the amount (${ART_720_MARKER}).`;

  return clean ? `${clean}\n${line}` : line;
}

const PESO = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
});

export function formatPeso(amount) {
  const value = Number(amount);
  if (amount == null || !Number.isFinite(value)) return null;
  return PESO.format(value);
}
