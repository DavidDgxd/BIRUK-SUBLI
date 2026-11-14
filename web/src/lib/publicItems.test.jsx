import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabase.js', () => ({ supabase: { rpc } }));
import ResultCard from '../components/ResultCard.jsx';
import {
  BROWSE_PAGE_SIZE,
  PublicItemsError,
  listPublicItems,
  listRecentItems,
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

  it('redacts cash and drops private inventory fields', () => {
    expect(normalizePublicItem(row('cash', {
      title: 'Brown envelope with PHP 5,000', category: 'Cash', is_cash: true,
      cash_amount: 5000, image_url: 'cash.jpg', description: 'Serial number 123',
      storage_location: 'Locker B', finder_name: 'Private Finder',
      claimant_name: 'Private Claimant',
    }))).toEqual({
      id: 'cash', title: 'Cash', category: 'Cash', status: 'held',
      image_url: null, date_received: '2026-11-01',
      holding_office_id: 'office-1', holding_office_name: 'Central Office',
    });
    expect(normalizePublicItem(row('id', { category: 'Document/ID', image_url: 'id.jpg' })).image_url).toBeNull();
  });

  it('turns database failures into PublicItemsError', async () => {
    rpc.mockReturnValue(response(null, { message: 'connection refused' }));
    await expect(listPublicItems()).rejects.toBeInstanceOf(PublicItemsError);
  });
});

describe('ResultCard browse mode', () => {
  it('renders public fields without a match score', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultCard browse item={{
          id: 'item-1', title: 'Blue wallet', category: 'Wallet', status: 'held',
          image_url: null, date_received: '2026-11-02',
          holding_office_name: 'Central Office',
        }} />
      </MemoryRouter>,
    );
    expect(html).toContain('Wallet · Central Office');
    expect(html).toContain('Held for collection · Received 2 Nov 2026');
    expect(html).not.toContain('% match');
  });
});
