import { useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import FieldLabel from './FieldLabel.jsx';
import {
  staffCloseLostReport,
  staffLookupLostReport,
} from '../lib/lostReport.js';

function formatDate(value) {
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
 * Counter fallback for a citizen who lost the private close link (US-33).
 *
 * The officer enters the reference code printed on the citizen's receipt and
 * can close an open report without the secret key. The RPC re-checks that the
 * caller is a signed-in active office (or the central admin); this panel is
 * only a convenience, never the security boundary.
 *
 * Lookup never returns close_key, and the closure always needs an explicit
 * confirmation click.
 */
export default function CloseLostReportPanel() {
  const [refCode, setRefCode] = useState('');
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | looking | found | not-found | error
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const controllerRef = useRef(null);
  const headingId = useId();
  const refId = useId();
  const errorId = useId();

  async function handleLookup(event) {
    event.preventDefault();
    if (status === 'looking') return;

    const cleanRef = refCode.trim();
    setError('');
    setConfirming(false);

    if (!cleanRef) {
      setReport(null);
      setStatus('not-found');
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setReport(null);
    setStatus('looking');

    try {
      const found = await staffLookupLostReport({
        refCode: cleanRef,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!found) {
        setStatus('not-found');
        return;
      }
      setReport(found);
      setStatus('found');
    } catch (lookupError) {
      if (controller.signal.aborted || lookupError.name === 'AbortError')
        return;
      if (import.meta.env.DEV) console.error('[CloseLostReportPanel]', lookupError);
      setStatus('error');
      setError(
        lookupError.message ?? 'We could not look up that report right now.',
      );
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  async function handleClose() {
    if (!report || status === 'looking') return;

    setError('');
    setStatus('looking');

    try {
      const closed = await staffCloseLostReport({ refCode: report.refCode });
      setReport((current) => ({
        ...current,
        status: closed.status,
        closedAt: closed.closedAt,
      }));
      setConfirming(false);
      setStatus('found');
    } catch (closeError) {
      if (import.meta.env.DEV) console.error('[CloseLostReportPanel]', closeError);
      setStatus('error');
      setError(closeError.message ?? 'We could not close that report right now.');
    }
  }

  const looking = status === 'looking';
  const closed = report?.status === 'closed';
  const dateLost = formatDate(report?.dateLost);

  return (
    <section
      className="counter-close"
      aria-labelledby={headingId}
      aria-describedby={`${headingId}-hint`}
    >
      <div className="counter-close__head">
        <h2 className="counter-close__title" id={headingId}>
          Close Lost Report (Counter Lookup)
        </h2>
      </div>
      <p className="counter-close__hint" id={`${headingId}-hint`}>
        If a citizen has their reference code but lost the private close link,
        look the report up here and close it for them.
      </p>

      <form
        className="counter-close__form"
        aria-label="Look up a lost report by reference code"
        onSubmit={handleLookup}
        noValidate
      >
        <div className="field">
          <FieldLabel htmlFor={refId} required>
            Citizen reference code
          </FieldLabel>
          <input
            id={refId}
            className="field__control field__control--mono"
            type="text"
            autoComplete="off"
            spellCheck="false"
            placeholder="LR-0100"
            required
            value={refCode}
            aria-invalid={status === 'not-found' ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setRefCode(event.target.value);
              if (status === 'not-found' || status === 'error') {
                setStatus('idle');
                setError('');
              }
            }}
          />
        </div>
        <button type="submit" className="btn" disabled={looking}>
          <Icon name="search" />
          {looking ? 'Looking up…' : 'Look Up'}
        </button>
      </form>

      <div aria-live="polite">
        {status === 'not-found' && (
          <p className="counter-close__empty" role="status">
            <Icon name="info" />
            No lost report found for that reference code.
          </p>
        )}

        {status === 'error' && error && (
          <p className="form-error" id={errorId} role="alert">
            <Icon name="error" />
            {error}
          </p>
        )}

        {report && (
          <div className="counter-close__report">
            <dl className="receipt-details">
              <div className="receipt-details__row">
                <dt>Reference code</dt>
                <dd className="counter-close__ref">{report.refCode}</dd>
              </div>
              <div className="receipt-details__row">
                <dt>Description</dt>
                <dd>{report.description}</dd>
              </div>
              <div className="receipt-details__row">
                <dt>Lost at</dt>
                <dd>{report.areaRoute}</dd>
              </div>
              {dateLost && (
                <div className="receipt-details__row">
                  <dt>Date lost</dt>
                  <dd>{dateLost}</dd>
                </div>
              )}
              <div className="receipt-details__row">
                <dt>Status</dt>
                <dd>
                  <span className="counter-close__status">{report.status}</span>
                </dd>
              </div>
            </dl>

            {report.status === 'open' && !confirming && (
              <div className="counter-close__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setConfirming(true)}
                  disabled={looking}
                >
                  <Icon name="check_circle" />
                  Close Report
                </button>
              </div>
            )}

            {report.status === 'open' && confirming && (
              <div
                className="counter-close__confirm"
                role="group"
                aria-label="Confirm closing this lost report"
              >
                <p>
                  Close this report for the citizen? Offices will stop matching
                  new items against it.
                </p>
                <div className="counter-close__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleClose}
                    disabled={looking}
                  >
                    <Icon name="check" />
                    {looking ? 'Closing…' : 'Yes, close report'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() => setConfirming(false)}
                    disabled={looking}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {closed && (
              <p className="counter-close__closed" role="status">
                <Icon name="check_circle" />
                Report closed. Offices will no longer match or contact the
                citizen about it.
              </p>
            )}

            {!closed && report.status !== 'open' && (
              <p className="counter-close__closed" role="status">
                <Icon name="info" />
                This report is {report.status}; there is nothing to close.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
