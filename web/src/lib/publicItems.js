import { supabase } from './supabase.js';
import { DOCUMENT_TITLE, isCashItem, isDocumentCategory } from './publicMasking.js';

export const BROWSE_PAGE_SIZE = 12, RECENT_ITEM_LIMIT = 6;
export class PublicItemsError extends Error {
  constructor(message) { super(message); this.name = 'PublicItemsError'; this.code = 'db'; }
}
export function browseOffset(page, pageSize = BROWSE_PAGE_SIZE) {
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : BROWSE_PAGE_SIZE;
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  return (safePage - 1) * size;
}
export function normalizePublicItem(row) {
  const cash = isCashItem({ category: row?.category, isCash: row?.is_cash });
  const secret = cash || isDocumentCategory(row?.category);
  return {
    id: row.id, title: cash ? 'Cash' : secret ? DOCUMENT_TITLE : row.title,
    category: cash ? 'Cash' : row.category, status: row.status ?? 'held',
    image_url: secret ? null : row.image_url ?? null,
    date_received: row.date_received ?? null,
    holding_office_id: row.holding_office_id ?? null,
    holding_office_name: row.holding_office_name ?? null,
  };
}
export async function listPublicItems({ page = 1, pageSize = BROWSE_PAGE_SIZE, office = null, dateFrom = null, dateTo = null, signal } = {}) {
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : BROWSE_PAGE_SIZE;
  const { data, error } = await supabase.rpc('list_public_items', {
    p_limit: size + 1, p_offset: browseOffset(page, size), p_office: office || null, p_date_from: dateFrom || null, p_date_to: dateTo || null,
  }).abortSignal(signal);
  if (error) throw new PublicItemsError(error.message);
  const rows = (data ?? []).map(normalizePublicItem);
  return { items: rows.slice(0, size), hasNext: rows.length > size };
}
export async function listRecentItems({ limit = RECENT_ITEM_LIMIT, signal } = {}) {
  const { items } = await listPublicItems({ page: 1, pageSize: limit, signal });
  return items;
}
