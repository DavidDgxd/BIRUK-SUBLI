import { useEffect, useId, useState } from 'react';
import Icon from './Icon.jsx';
import { listOffices } from '../lib/offices.js';
import { buildLoginHistoryCsv, fetchLoginHistory, loginHistoryCsvFilename, pruneLoginHistory } from '../lib/loginHistory.js';

/*
 * Login history table and filters (US-37).
 *
 * Shared by /admin/login-history and the Login history tab on /admin/offices,
 * so the two views cannot drift. The list is newest first and every filter is
 * applied server-side. Admin rows have no office id (they belong to no office),
 * so choosing "Central admin" sends a role filter rather than an office filter;
 * this keeps older admin rows reachable beyond the first page.
 */

const ALL = '';
const CENTRAL_ADMIN = 'central_admin';

const EMPTY_FILTERS = {
  office: ALL,
  search: '',
  status: 'all',
  from: '',
  to: '',
};

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function LoginHistoryPanel({ active = true }) {
  const [offices, setOffices] = useState([]);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState(null); // null while a load runs
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [retainDays, setRetainDays] = useState('90');
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [pruneMessage, setPruneMessage] = useState('');
  const [pruneError, setPruneError] = useState(false);

  // The admin tabs keep this panel mounted but hidden, so it must not fetch
  // until its tab has actually been opened.
  const isActive = active;

  const officeId = useId();
  const searchId = useId();
  const statusId = useId();
  const fromId = useId();
  const toId = useId();
  const retentionId = useId();

  // The office picker is a convenience; a failure leaves the account search and
  // the "All offices" option usable.
  useEffect(() => {
    if (!isActive) return undefined;
    const controller = new AbortController();
    let live = true;

    listOffices({ signal: controller.signal })
      .then((data) => {
        if (live) setOffices(data);
      })
      .catch((error) => {
        if (error.name === 'AbortError' || !live) return;
        if (import.meta.env.DEV) console.warn('[LoginHistoryPanel]', error);
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return undefined;
    const controller = new AbortController();
    let live = true;
    const adminOnly = applied.office === CENTRAL_ADMIN;

    setRows(null);
    setLoadError('');

    fetchLoginHistory(
      {
        officeId: adminOnly ? null : applied.office || null,
        search: applied.search,
        status: applied.status,
        dateFrom: applied.from,
        dateTo: applied.to,
        role: adminOnly ? CENTRAL_ADMIN : null,
      },
      { signal: controller.signal },
    )
      .then((data) => {
        if (!live) return;
        setRows(data);
      })
      .catch((error) => {
        if (!live || error.name === 'AbortError') return;
        if (import.meta.env.DEV) console.error('[LoginHistoryPanel]', error);
        setRows([]);
        setLoadError(
          error?.code === 'forbidden'
            ? 'This log is only available to the central admin.'
            : 'We could not load the login history right now.',
        );
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [isActive, applied, reloadKey]);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    if (formError) setFormError('');
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setFormError('The from date must be on or before the to date.');
      return;
    }
    setFormError('');
    // A new object, so re-applying the same values still refreshes the list.
    setApplied({ ...draft, search: draft.search.trim() });
  }

  function handleClear() {
    setDraft(EMPTY_FILTERS);
    setFormError('');
    setApplied({ ...EMPTY_FILTERS });
  }

  function handleExport() {
    if (!rows?.length) return;
    const url = URL.createObjectURL(
      new Blob([buildLoginHistoryCsv(rows)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: loginHistoryCsvFilename(),
    });
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handlePrune() {
    if (!confirmPrune) return setConfirmPrune(true);
    setConfirmPrune(false); setPruning(true); setPruneError(false); setPruneMessage('');
    try {
      const deleted = await pruneLoginHistory({ retainDays: Number(retainDays) });
      setPruneMessage(
        `Removed ${deleted} ${deleted === 1 ? 'row' : 'rows'} older than ${retainDays} days.`,
      );
      setReloadKey((key) => key + 1);
    } catch (error) {
      if (import.meta.env.DEV) console.error('[LoginHistoryPanel]', error);
      setPruneError(true);
      setPruneMessage(
        error?.code === 'forbidden'
          ? 'Only the central admin can prune login history.'
          : 'We could not prune login history right now.',
      );
    } finally {
      setPruning(false);
    }
  }

  return (
    <div className="login-history">
      <form
        className="login-history__filters"
        aria-label="Filter login history"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="field">
          <label className="field__label" htmlFor={officeId}>
            Office or account
          </label>
          <select
            id={officeId}
            className="field__control"
            value={draft.office}
            onChange={(event) => update('office', event.target.value)}
          >
            <option value={ALL}>All offices and accounts</option>
            <option value={CENTRAL_ADMIN}>Central admin</option>
            {offices.map((office) => (
              <option key={office.id} value={office.id}>
                {office.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={searchId}>
            Account search
          </label>
          <input
            id={searchId}
            className="field__control"
            type="search"
            value={draft.search}
            placeholder="Office name or email"
            onChange={(event) => update('search', event.target.value)}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={statusId}>
            Status
          </label>
          <select
            id={statusId}
            className="field__control"
            value={draft.status}
            onChange={(event) => update('status', event.target.value)}
          >
            <option value="all">All</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={fromId}>
            From
          </label>
          <input
            id={fromId}
            className="field__control"
            type="date"
            value={draft.from}
            onChange={(event) => update('from', event.target.value)}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={toId}>
            To
          </label>
          <input
            id={toId}
            className="field__control"
            type="date"
            value={draft.to}
            onChange={(event) => update('to', event.target.value)}
          />
        </div>

        <div className="login-history__actions">
          <button type="submit" className="btn btn--primary">
            <Icon name="tune" />
            Apply filters
          </button>
          <button type="button" className="btn" onClick={handleClear}>
            Clear
          </button>
        </div>

        <p
          className={formError ? 'form-error' : 'visually-hidden'}
          aria-live="polite"
        >
          {formError && (
            <>
              <Icon name="error" />
              {formError}
            </>
          )}
        </p>
      </form>

      <div className="login-history__tools">
        <button type="button" className="btn" onClick={handleExport} disabled={!rows?.length}>
          <Icon name="download" /> Export CSV
        </button>

        <div className="login-history__retention">
          <div className="field">
            <label className="field__label" htmlFor={retentionId}>Prune rows older than</label>
            <select
              id={retentionId}
              className="field__control"
              value={retainDays}
              onChange={(event) => {
                setRetainDays(event.target.value); setConfirmPrune(false); setPruneMessage('');
              }}
            >
              {[30, 90, 180, 365].map((days) => (
                <option key={days} value={days}>{days} days</option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn--quiet" onClick={handlePrune} disabled={pruning}>
            <Icon name="delete" />
            {pruning ? 'Pruning…' : confirmPrune ? 'Confirm prune' : 'Prune login history'}
          </button>
          {confirmPrune && (
            <div className="login-history__confirm" role="alert">
              Delete rows older than {retainDays} days? This cannot be undone.
              <button type="button" className="btn btn--quiet" onClick={() => setConfirmPrune(false)}>Cancel</button>
            </div>
          )}
          {pruneMessage && (
            <p className={pruneError ? 'form-error' : 'login-history__feedback'} role={pruneError ? 'alert' : 'status'}>
              {pruneMessage}
            </p>
          )}
        </div>
      </div>

      {loadError ? (
        <section className="state state--error" role="alert">
          <h3 className="state__title">
            Could not load login history
          </h3>
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
        <p className="login-history__empty" role="status">
          Loading login history…
        </p>
      ) : rows.length === 0 ? (
        <p className="login-history__empty">
          No sign-in activity matches these filters.
        </p>
      ) : (
        <div className="login-history__table-wrap">
          <div
            className="login-history__table"
            role="table"
            aria-label="Login history, newest first"
          >
            <div className="login-history__head" role="rowgroup">
              <div className="login-history__row" role="row">
                <div
                  role="columnheader"
                  className="login-history__cell login-history__when"
                >
                  When
                </div>
                <div
                  role="columnheader"
                  className="login-history__cell login-history__account"
                >
                  Office or account
                </div>
                <div
                  role="columnheader"
                  className="login-history__cell login-history__role"
                >
                  Role
                </div>
                <div
                  role="columnheader"
                  className="login-history__cell login-history__status"
                >
                  Status
                </div>
                <div
                  role="columnheader"
                  className="login-history__cell login-history__device"
                >
                  Device
                </div>
              </div>
            </div>
            <div className="login-history__body" role="rowgroup">
              {rows.map((row) => (
                <div key={row.id} className="login-history__row" role="row">
                  <div
                    role="cell"
                    className="login-history__cell login-history__when"
                    data-label="When"
                  >
                    <time dateTime={row.occurredAt}>
                      {formatWhen(row.occurredAt)}
                    </time>
                  </div>
                  <div
                    role="rowheader"
                    className="login-history__cell login-history__account"
                  >
                    {row.accountLabel}
                  </div>
                  <div
                    role="cell"
                    className="login-history__cell login-history__role"
                    data-label="Role"
                  >
                    <span className={`login-badge login-badge--${row.role}`}>
                      {row.roleLabel}
                    </span>
                  </div>
                  <div
                    role="cell"
                    className="login-history__cell login-history__status"
                    data-label="Status"
                  >
                    <span className={`login-badge login-badge--${row.status}`}>
                      {row.statusLabel}
                    </span>
                    {row.failureLabel && (
                      <span className="login-history__reason">
                        {row.failureLabel}
                      </span>
                    )}
                  </div>
                  <div
                    role="cell"
                    className="login-history__cell login-history__device"
                    data-label="Device"
                  >
                    {row.deviceLabel}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
