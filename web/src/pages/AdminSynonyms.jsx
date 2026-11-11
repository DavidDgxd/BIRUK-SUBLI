import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import StaffGate from '../components/StaffGate.jsx';
import StaffBar from '../components/StaffBar.jsx';
import Icon from '../components/Icon.jsx';
import { deleteSynonym, listSynonyms, saveSynonym } from '../lib/synonyms.js';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

const MAX_TERM = 64;
const MAX_SYNONYM = 64;
const MAX_NOTES = 240;

function emptyForm() {
  return { term: '', synonyms: '', enabled: true, notes: '' };
}

function formatUpdated(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

/*
 * Central-admin search vocabulary (follow-up to US-22).
 *
 * The search box expands Filipino terms to English before embedding. Those
 * pairs live in public.search_synonyms so they can be corrected without a
 * deploy; the AI service picks changes up on its next 60-second refresh. The
 * RPCs re-check the central-admin role, so this page is a convenience only.
 */
export default function AdminSynonyms() {
  const { status, isAdmin } = useStaffAuth();
  const headingRef = useRef(null);
  const termRef = useRef(null);
  const synonymsRef = useRef(null);
  const confirmRef = useRef(null);
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [filter, setFilter] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const termId = useId();
  const synonymsId = useId();
  const notesId = useId();
  const filterId = useId();
  const hintId = useId();
  const errorId = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (confirmingDelete) confirmRef.current?.focus();
  }, [confirmingDelete]);

  useEffect(() => {
    if (status !== 'authenticated' || !isAdmin) return undefined;

    const controller = new AbortController();
    let active = true;

    setLoadError('');
    setRows(null);
    listSynonyms({ signal: controller.signal })
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        if (import.meta.env.DEV) console.error('[AdminSynonyms]', error);
        setRows([]);
        setLoadError('We could not load the search vocabulary right now.');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey, status, isAdmin]);

  const visibleRows = (rows ?? []).filter((row) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return (
      row.term.includes(needle) ||
      row.synonyms.some((synonym) => synonym.toLowerCase().includes(needle))
    );
  });

  function resetForm() {
    setForm(emptyForm());
    setEditing(null);
    setFormError('');
  }

  function startEdit(row) {
    setEditing(row.term);
    setForm({
      term: row.term,
      synonyms: row.synonyms.join(', '),
      enabled: row.enabled,
      notes: row.notes ?? '',
    });
    setFormError('');
    synonymsRef.current?.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;

    const term = form.term.trim().toLowerCase();
    const synonyms = form.synonyms
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const notes = form.notes.trim();

    if (!term) {
      setFormError('Enter the Filipino word or phrase.');
      termRef.current?.focus();
      return;
    }
    if (term.length > MAX_TERM) {
      setFormError(`Keep the term under ${MAX_TERM} characters.`);
      termRef.current?.focus();
      return;
    }
    if (synonyms.length === 0) {
      setFormError('Add at least one English synonym.');
      synonymsRef.current?.focus();
      return;
    }
    if (synonyms.some((value) => value.length > MAX_SYNONYM)) {
      setFormError(`Keep each synonym under ${MAX_SYNONYM} characters.`);
      synonymsRef.current?.focus();
      return;
    }
    if (notes.length > MAX_NOTES) {
      setFormError(`Keep notes under ${MAX_NOTES} characters.`);
      return;
    }

    setFormError('');
    setSaving(true);
    try {
      await saveSynonym({
        term,
        synonyms,
        enabled: form.enabled,
        notes,
      });
      setAnnouncement(`Saved “${term}”.`);
      resetForm();
      setReloadKey((key) => key + 1);
    } catch (error) {
      if (import.meta.env.DEV) console.error('[AdminSynonyms]', error);
      setFormError('We could not save that term. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row) {
    if (deleting) return;
    setDeleting(row.term);
    setFormError('');
    try {
      await deleteSynonym(row.term);
      setAnnouncement(`Deleted “${row.term}”.`);
      setConfirmingDelete(null);
      if (editing === row.term) resetForm();
      setReloadKey((key) => key + 1);
    } catch (error) {
      if (import.meta.env.DEV) console.error('[AdminSynonyms]', error);
      setFormError('We could not delete that term. Please try again.');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <SiteHeader />
        <main id="main" className="admin-page">
          <Link className="back-link" to="/admin/offices">
            <Icon name="arrow_back" />
            Back to offices
          </Link>

          <div className="page-head">
            <h1 tabIndex={-1} ref={headingRef}>
              Search synonyms
            </h1>
            <p className="lead">
              Filipino words the search box expands to English before matching.
              Changes reach the search service within a minute, without a
              deploy.
            </p>
          </div>

          <StaffGate
            title="Admin sign-in required"
            message="Search vocabulary is only available to the central admin."
            deniedTitle="Central admin only"
            deniedMessage="This vocabulary is managed by the central admin. Your office login still works on the counter pages."
            requireAdmin
            from="/admin/synonyms"
          >
            <>
              <StaffBar icon="verified_user" label="Central admin" />

              <p className="visually-hidden" role="status">
                {announcement}
              </p>

              <section className="synonym-editor" aria-labelledby={termId}>
                <form className="form synonym-form" onSubmit={handleSubmit}>
                  <h2 className="form__legend" id={termId}>
                    {editing ? `Edit “${editing}”` : 'Add a term'}
                  </h2>

                  <div className="field">
                    <label className="field__label" htmlFor={`${termId}-term`}>
                      Filipino term
                      <span className="field__required" aria-hidden="true">
                        *
                      </span>
                    </label>
                    <input
                      ref={termRef}
                      id={`${termId}-term`}
                      className="field__control"
                      value={form.term}
                      onChange={(event) =>
                        setForm((previous) => ({
                          ...previous,
                          term: event.target.value,
                        }))
                      }
                      maxLength={MAX_TERM}
                      readOnly={Boolean(editing)}
                      required
                      autoComplete="off"
                      aria-describedby={hintId}
                    />
                  </div>

                  <div className="field">
                    <label
                      className="field__label"
                      htmlFor={`${synonymsId}-synonyms`}
                    >
                      English synonyms
                      <span className="field__required" aria-hidden="true">
                        *
                      </span>
                    </label>
                    <input
                      ref={synonymsRef}
                      id={`${synonymsId}-synonyms`}
                      className="field__control"
                      value={form.synonyms}
                      onChange={(event) =>
                        setForm((previous) => ({
                          ...previous,
                          synonyms: event.target.value,
                        }))
                      }
                      required
                      autoComplete="off"
                      aria-describedby={hintId}
                    />
                    <p className="field__hint" id={hintId}>
                      Comma-separated, for example “wallet, purse”.
                    </p>
                  </div>

                  <div className="field">
                    <label
                      className="field__label"
                      htmlFor={`${notesId}-notes`}
                    >
                      Notes
                      <span className="field__optional"> optional</span>
                    </label>
                    <input
                      id={`${notesId}-notes`}
                      className="field__control"
                      value={form.notes}
                      onChange={(event) =>
                        setForm((previous) => ({
                          ...previous,
                          notes: event.target.value,
                        }))
                      }
                      maxLength={MAX_NOTES}
                      autoComplete="off"
                      placeholder="Why this term exists, or where it came from"
                    />
                  </div>

                  <label
                    className="synonym-toggle"
                    htmlFor={`${termId}-enabled`}
                  >
                    <input
                      id={`${termId}-enabled`}
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) =>
                        setForm((previous) => ({
                          ...previous,
                          enabled: event.target.checked,
                        }))
                      }
                    />
                    Enabled
                  </label>

                  {formError && (
                    <p className="form-error" id={errorId} role="alert">
                      {formError}
                    </p>
                  )}

                  <div className="form-actions">
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={saving}
                    >
                      <Icon name={editing ? 'check' : 'add'} />
                      {saving
                        ? 'Saving…'
                        : editing
                          ? 'Save changes'
                          : 'Add term'}
                    </button>
                    {editing && (
                      <button type="button" className="btn" onClick={resetForm}>
                        <Icon name="close" />
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </section>

              <section className="office-admin" aria-label="Search vocabulary">
                <div className="admin-toolbar">
                  <div className="field synonym-filter">
                    <label className="field__label" htmlFor={filterId}>
                      Filter terms
                    </label>
                    <input
                      id={filterId}
                      className="field__control"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      placeholder="Search terms or synonyms"
                      autoComplete="off"
                    />
                  </div>
                </div>

                {loadError ? (
                  <section className="state state--error" role="alert">
                    <h3 className="state__title">Could not load vocabulary</h3>
                    <p className="state__text">{loadError}</p>
                    <div className="state__actions">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setReloadKey((key) => key + 1)}
                      >
                        <Icon name="refresh" />
                        Try again
                      </button>
                    </div>
                  </section>
                ) : rows === null ? (
                  <p className="office-admin__empty" role="status">
                    Loading vocabulary…
                  </p>
                ) : visibleRows.length === 0 ? (
                  <p className="office-admin__empty">
                    {rows.length === 0
                      ? 'No terms yet. Add the first one above.'
                      : 'No terms match that filter.'}
                  </p>
                ) : (
                  <div className="synonym-table-wrap">
                    <table className="synonym-table">
                      <caption className="visually-hidden">
                        Search synonyms managed by the central admin
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Term</th>
                          <th scope="col">English synonyms</th>
                          <th scope="col">Status</th>
                          <th scope="col">Updated</th>
                          <th scope="col">
                            <span className="visually-hidden">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((row) => (
                          <tr
                            key={row.term}
                            className={row.enabled ? undefined : 'is-disabled'}
                          >
                            <th scope="row">
                              <code>{row.term}</code>
                            </th>
                            <td>
                              {row.synonyms.join(', ')}
                              {row.notes && (
                                <span className="synonym-note">
                                  {row.notes}
                                </span>
                              )}
                            </td>
                            <td>
                              <span
                                className={`office-status office-status--${
                                  row.enabled ? 'ready' : 'suspended'
                                }`}
                              >
                                {row.enabled ? 'Enabled' : 'Disabled'}
                              </span>
                            </td>
                            <td>
                              {formatUpdated(row.updated_at)}
                              <span className="synonym-note">
                                {row.updated_by || 'Seed'}
                              </span>
                            </td>
                            <td>
                              <div className="synonym-actions">
                                {confirmingDelete === row.term ? (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn--quiet"
                                      ref={confirmRef}
                                      onClick={() => handleDelete(row)}
                                      disabled={deleting === row.term}
                                      aria-label={`Confirm delete ${row.term}`}
                                    >
                                      <Icon name="close" />
                                      {deleting === row.term
                                        ? 'Deleting…'
                                        : 'Confirm delete'}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn--quiet"
                                      onClick={() => {
                                        setConfirmingDelete(null);
                                        setAnnouncement(`Kept “${row.term}”.`);
                                      }}
                                      disabled={deleting === row.term}
                                      aria-label={`Cancel delete ${row.term}`}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn--quiet"
                                      onClick={() => startEdit(row)}
                                      aria-label={`Edit ${row.term}`}
                                    >
                                      <Icon name="description" />
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn--quiet"
                                      onClick={() => {
                                        setConfirmingDelete(row.term);
                                        setAnnouncement(
                                          `Confirm deleting “${row.term}”.`,
                                        );
                                      }}
                                      aria-label={`Delete ${row.term}`}
                                    >
                                      <Icon name="close" />
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          </StaffGate>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
