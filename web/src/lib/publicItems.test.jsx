import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabase.js', () => ({ supabase: { rpc } }));
import {
  BROWSE_PAGE_SIZE, PublicItemsError, listPublicItems, listRecentItems,
  normalizePublicItem,
} from './publicItems.js';
const response = (data = [], error = null) => ({
  abortSignal: vi.fn().mockResolvedValue({ data, error }),
});
const row = (id, extra = {}) => ({
  id, title: `Item ${id}`, category: 'General', status: 'held', image_url: null,
  date_received: '2026-11-01', holding_office_id: 'office-1',
  holding_office_name: 'Central Office', ...extra,
});

describe('public item browse', () => {
  beforeEach(() => rpc.mockReset());

  it('requests a filtered page with a lookahead row', async () => {
    rpc.mockReturnValue(response(Array.from({ length: 13 }, (_, i) => row(i))));
    const result = await listPublicItems({
      page: 2, office: 'office-2', dateFrom: '2026-10-01', dateTo: '2026-10-31',
    });
    expect(rpc).toHaveBeenCalledWith('list_public_items', {
      p_limit: 13, p_offset: BROWSE_PAGE_SIZE, p_office: 'office-2',
      p_date_from: '2026-10-01', p_date_to: '2026-10-31',
    });
    expect(result.items).toHaveLength(BROWSE_PAGE_SIZE);
    expect(result.hasNext).toBe(true);
  });

  it('loads six recent items for the landing strip', async () => {
    rpc.mockReturnValue(response(Array.from({ length: 6 }, (_, i) => row(i))));
    expect(await listRecentItems()).toHaveLength(6);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_limit: 7, p_offset: 0 });
  });

  it('redacts cash and Document/ID fields in the browser', () => {
    const cash = normalizePublicItem(row('cash', {
      title: 'Brown envelope', category: 'Cash', is_cash: true, cash_amount: 5000,
      image_url: 'cash.jpg', description: 'Serial 123', storage_location: 'Locker B',
      finder_name: 'Private Finder', claimant_name: 'Private Claimant',
    }));
    expect(cash).toMatchObject({ title: 'Cash', category: 'Cash', image_url: null });
    expect(cash).not.toHaveProperty('cash_amount');
    expect(normalizePublicItem(row('id', {
      title: 'Juan Dela Cruz ID', category: 'Document/ID', image_url: 'id.jpg',
    }))).toMatchObject({ title: 'Document/ID', image_url: null });
  });

  it('redacts cash and Document/ID in the get_item_public SQL', () => {
    const url = new URL('../../../supabase/migrations/20261114120000_public_browse_items.sql', import.meta.url);
    const body = readFileSync(url, 'utf8').split('function public.get_item_public')[1];
    expect(body).toMatch(/items\.is_cash or items\.category = 'Cash' then 'Cash'/);
    expect(body).toMatch(/items\.category = 'Document\/ID' then 'Document\/ID'/);
    expect(body).toMatch(/or items\.category = 'Document\/ID' then null else items\.image_url/);
  });

  it('turns database failures into PublicItemsError', async () => {
    rpc.mockReturnValue(response(null, { message: 'connection refused' }));
    await expect(listPublicItems()).rejects.toBeInstanceOf(PublicItemsError);
  });
});
