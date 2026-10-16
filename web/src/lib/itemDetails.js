import { supabase } from './supabase.js';

/** code: 'not-found' | 'db' */
export class ItemDetailError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ItemDetailError';
    this.code = code;
  }
}

/*
 * A uuid Postgres will accept for `uuid`. Checked here so a hand-typed or
 * truncated link ("/items/12") reads as "no such item" rather than reaching the
 * RPC and coming back as a 22P02 invalid-input error, which would show the user
 * a database message for what is really a bad URL.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One held item, for the standalone detail page at /items/:id (US-18).
 *
 * Reads through the get_item_public RPC rather than the items table. That is
 * not a preference: anon has no table-level SELECT on items at all, because a
 * row-level policy would still hand over every column of a held item —
 * `description` (the marks and serial numbers the counter checks against) and
 * `storage_location` included. The RPC is the only public read path, and it
 * returns the same projection match_items does, so this page can be opened
 * directly or refreshed without the search that found it.
 *
 * Rejects with ItemDetailError: 'not-found' for a malformed id or an item that
 * is not held (released and disposed items are deliberately invisible), and
 * 'db' for a transport or Postgres failure. An abort propagates as-is so the
 * caller can ignore it.
 */
export async function fetchPublicItem(id, signal) {
  const clean = (id ?? '').trim();

  if (!UUID_PATTERN.test(clean)) {
    throw new ItemDetailError('not-found', `"${clean}" is not an item id.`);
  }

  const { data, error } = await supabase
    .rpc('get_item_public', { item_id_input: clean })
    .abortSignal(signal);

  if (error) throw new ItemDetailError('db', error.message);

  // A table-returning RPC resolves to an array: empty means no held item has
  // that id, which is the 404 case.
  const item = data?.[0];
  if (!item) {
    throw new ItemDetailError('not-found', `No held item with id ${clean}.`);
  }

  return item;
}
