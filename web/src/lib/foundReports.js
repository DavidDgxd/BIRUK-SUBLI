import { supabase } from './supabase.js';

/** code: 'db' */
export class FoundReportsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FoundReportsError';
    this.code = code;
  }
}

const PENDING_COLUMNS = [
  'id',
  'ref_code',
  'short_note',
  'found_location',
  'found_date',
  'finder_contact',
  'image_url',
  'created_at',
].join(', ');

/**
 * Self-reports waiting for the finder to hand the item in at a counter (US-10).
 *
 * The public form writes these rows through submit_found_report, but only a
 * signed-in staff session can read them: finder_contact is staff-visible PII
 * and found_reports has no public SELECT policy. The list is citywide because
 * the finder may drop the item at any participating office.
 */
export async function listPendingFoundReports({ signal } = {}) {
  let query = supabase
    .from('found_reports')
    .select(PENDING_COLUMNS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .order('ref_code', { ascending: true });

  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw new FoundReportsError('db', error.message);

  return data ?? [];
}

/**
 * The fields the intake form can copy from a self-report.
 *
 * A self-report has one short note rather than separate public/private copy, so
 * the note seeds both the public title (trimmed to fit) and the private
 * verification notes. The officer reviews and edits both before confirming.
 */
export function intakePrefillFromReport(report) {
  const note = String(report?.short_note ?? '').trim();

  return {
    title: titleFromNote(note),
    description: note,
    finderContact: String(report?.finder_contact ?? '').trim(),
    photoUrl: report?.image_url ?? '',
    refCode: report?.ref_code ?? '',
    reportId: report?.id ?? null,
  };
}

function titleFromNote(note) {
  const clean = note.replace(/\s+/g, ' ');
  if (clean.length <= 120) return clean;

  const cut = clean.slice(0, 117);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 80 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
