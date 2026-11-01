import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import {
  PENDING_REPORT_PAGE_SIZE,
  listPendingFoundReports,
} from '../lib/foundReports.js';

function formatFoundDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/*
 * The intake queue for online self-reports (US-10).
 *
 * A finder can submit the report before walking to a counter. When they arrive,
 * the officer picks that report here instead of retyping the note or asking the
 * finder to upload the photo again. Selecting a row only pre-fills the form;
 * the officer still reviews and confirms the custody record.
 */
export default function PendingSelfReports({
  selectedId,
  onSelect,
  refreshKey = 0,
}) {
  const [reports, setReports] = useState(null);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const moreControllerRef = useRef(null);
  const headingId = useId();
  const queueLabel = useId();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setReports(null);
    setTotal(0);
    setLoadError('');
    setMoreError('');

    listPendingFoundReports({ signal: controller.signal })
      .then(({ reports: rows, total: totalCount }) => {
        if (!active) return;
        setReports(rows);
        setTotal(totalCount);
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        if (import.meta.env.DEV) console.error('[PendingSelfReports]', error);
        setReports([]);
        setTotal(0);
        setLoadError('We could not load pending self-reports right now.');
      });

    return () => {
      active = false;
      controller.abort();
      moreControllerRef.current?.abort();
    };
  }, [refreshKey, retryKey]);

  async function loadMore() {
    if (loadingMore || !reports) return;

    const controller = new AbortController();
    moreControllerRef.current = controller;
    setLoadingMore(true);
    setMoreError('');

    try {
      const { reports: rows, total: totalCount } =
        await listPendingFoundReports({
          signal: controller.signal,
          offset: reports.length,
        });
      if (controller.signal.aborted) return;

      setReports((current) => {
        const seen = new Set((current ?? []).map((report) => report.id));
        return [
          ...(current ?? []),
          ...rows.filter((report) => !seen.has(report.id)),
        ];
      });
      setTotal(totalCount);
    } catch (error) {
      if (controller.signal.aborted || error.name === 'AbortError') return;
      if (import.meta.env.DEV) console.error('[PendingSelfReports]', error);
      setMoreError('We could not load more pending self-reports.');
    } finally {
      if (moreControllerRef.current === controller) {
        moreControllerRef.current = null;
        setLoadingMore(false);
      }
    }
  }

  const loading = reports === null;
  const hasMore = reports !== null && reports.length < total;
  const remaining = hasMore ? total - reports.length : 0;

  return (
    <section
      className="pending-reports"
      aria-labelledby={headingId}
      aria-describedby={queueLabel}
    >
      <div className="pending-reports__head">
        <h2 className="pending-reports__title" id={headingId}>
          Pending self-reports
        </h2>
        {!loading && !loadError && (
          <span className="pending-reports__count">{total} waiting</span>
        )}
      </div>
      <p className="pending-reports__hint" id={queueLabel}>
        If the finder already reported online, select it to copy their photo and
        note into the intake form.
      </p>

      {loadError && (
        <div className="pending-reports__error" role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => setRetryKey((key) => key + 1)}
          >
            <Icon name="refresh" />
            Try again
          </button>
        </div>
      )}

      {loading && (
        <p className="loading" role="status">
          <Icon name="hourglass_top" className="icon--pulse" />
          Loading self-reports…
        </p>
      )}

      {!loading && !loadError && reports.length === 0 && (
        <p className="pending-reports__empty">
          No pending self-reports. Start the intake form below.
        </p>
      )}

      {!loading && !loadError && reports.length > 0 && (
        <>
          <ul className="pending-reports__list">
            {reports.map((report) => {
              const selected = report.id === selectedId;
              const foundDate = formatFoundDate(report.found_date);

              return (
                <li key={report.id}>
                  <button
                    type="button"
                    className="pending-report"
                    aria-pressed={selected}
                    onClick={() => onSelect(report)}
                  >
                    <img
                      className="pending-report__photo"
                      src={report.image_url}
                      alt=""
                      width="56"
                      height="56"
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="pending-report__body">
                      <span className="pending-report__ref">
                        {report.ref_code}
                      </span>
                      <span className="pending-report__note">
                        {report.short_note}
                      </span>
                      <span className="pending-report__meta">
                        {report.found_location}
                        {foundDate && <span>Found {foundDate}</span>}
                      </span>
                    </span>
                    <span className="pending-report__action" aria-hidden="true">
                      {selected ? 'Selected' : 'Use'}
                      <Icon
                        name={selected ? 'check' : 'chevron_right'}
                        size={18}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <div className="pending-reports__more">
              <button
                type="button"
                className="btn"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <Icon name="hourglass_top" className="icon--pulse" />
                    Loading…
                  </>
                ) : (
                  `Show ${Math.min(PENDING_REPORT_PAGE_SIZE, remaining)} more`
                )}
              </button>
              <span className="pending-reports__more-count">
                Showing {reports.length} of {total}
              </span>
              {moreError && (
                <p className="pending-reports__more-error" role="alert">
                  {moreError}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
