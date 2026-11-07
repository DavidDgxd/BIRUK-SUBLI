import { supabase } from './supabase.js';

/** code: 'db' */
export class SynonymError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SynonymError';
    this.code = code;
  }
}

/**
 * Loads the admin-managed bilingual search vocabulary. The RPC re-checks the
 * central-admin role server-side; this module only carries the request.
 */
export async function listSynonyms({ signal } = {}) {
  let query = supabase.rpc('list_search_synonyms');
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new SynonymError('db', error.message);
  return data ?? [];
}

/** Adds a term or replaces its synonyms and enabled flag. */
export async function saveSynonym(
  { term, synonyms, enabled = true },
  { signal } = {},
) {
  let query = supabase.rpc('upsert_search_synonym', {
    p_term: term,
    p_synonyms: synonyms,
    p_enabled: enabled,
  });
  if (signal) query = query.abortSignal(signal);

  const { error } = await query;
  if (error) throw new SynonymError('db', error.message);
}

export async function deleteSynonym(term, { signal } = {}) {
  let query = supabase.rpc('delete_search_synonym', { p_term: term });
  if (signal) query = query.abortSignal(signal);

  const { error } = await query;
  if (error) throw new SynonymError('db', error.message);
}
