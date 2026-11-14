import { supabase } from './supabase.js';

export const BROWSE_PAGE_SIZE = 12;
export const RECENT_ITEM_LIMIT = 6;

export class PublicItemsError extends Error {
  constructor(message) { super(message); this.name = 'PublicItemsError'; this.code = 'db'; }
}

export function browseOffset(page, pageSize = BROWSE_PAGE_SIZE) {
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : BROWSE_PAGE_SIZE;
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  return (safePage - 1) * size;
}

export function normalizePublicItem(row) {
  const cash = row?.is_cash === true || row?.category === 'Cash';
  return {
    id: row.id, title: cash ? 'Cash' : row.title, category: cash ? 'Cash' : row.category,
    status: row.status ?? 'held', image_url: cash || row.category === 'Document/ID' ? null : row.image_url ?? null,
    date_received: row.date_received ?? null,
    holding_office_id: row.holding_office_id ?? null,
    holding_office_name: row.holding_office_name ?? null,
  };
}

export async function listPublicItems({
  page = 1, pageSize = BROWSE_PAGE_SIZE, office = null,
  dateFrom = null, dateTo = null, signal,
} = {}) {
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : BROWSE_PAGE_SIZE;
  const query = supabase.rpc('list_public_items', {
    p_limit: size + 1, p_offset: browseOffset(page, size),
    p_office: office || null, p_date_from: dateFrom || null, p_date_to: dateTo || null,
  }).abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new PublicItemsError(error.message);

  const rows = (data ?? []).map(normalizePublicItem);
  return { items: rows.slice(0, size), hasNext: rows.length > size };
}

export async function listRecentItems({ limit = RECENT_ITEM_LIMIT, signal } = {}) {
  const { items } = await listPublicItems({ page: 1, pageSize: limit, signal });
  return items;
}
