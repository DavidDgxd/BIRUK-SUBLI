import { useEffect, useId, useState } from 'react';
import Icon from './Icon.jsx';
import { listPendingFoundReports } from '../lib/foundReports.js';

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
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const headingId = useId();
  const queueLabel = useId();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setReports(null);
    setLoadError('');

    listPendingFoundReports({ signal: controller.signal })
      .then((rows) => {
        if (active) setReports(rows);
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        if (import.meta.env.DEV) console.error('[PendingSelfReports]', error);
        setReports([]);
        setLoadError('We could not load pending self-reports right now.');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshKey, retryKey]);

  const loading = reports === null;

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
          <span className="pending-reports__count">
            {reports.length} waiting
          </span>
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
                    <Icon name={selected ? 'check' : 'chevron_right'} size={18} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
