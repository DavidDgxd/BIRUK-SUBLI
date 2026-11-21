import { useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import FieldLabel from '../components/FieldLabel.jsx';
import Icon from '../components/Icon.jsx';
import {
  CLOSE_REPORT_NOT_FOUND_MESSAGE,
  closeLostReport,
} from '../lib/lostReport.js';

/*
 * Public self-service closure for a lost report (US-33), mounted at
 * /close-report.
 *
 * The page only reads `ref` and `key` from the query string. It deliberately
 * never calls the RPC on load: email clients and link-preview bots fetch URLs,
 * and a GET must not close a report. The citizen has to press the confirmation
 * button, which then calls close_lost_report_by_key.
 *
 * Every failure — missing key, wrong key, unknown ref_code — shows the same
 * sentence from the lib, so this page cannot be used to test which ref_codes
 * exist (AC 3).
 */
export default function CloseLostReport() {
  const [searchParams] = useSearchParams();
  const headingRef = useRef(null);
  const errorRef = useRef(null);

  const [refCode, setRefCode] = useState(searchParams.get('ref') ?? '');
  const [closeKey, setCloseKey] = useState(searchParams.get('key') ?? '');
  const [status, setStatus] = useState('idle'); // 'idle' | 'closing' | 'closed'
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const refId = useId();
  const keyId = useId();
  const keyHintId = useId();
  const errorId = useId();
  const successTitleId = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (status === 'closed') headingRef.current?.focus();
  }, [status]);

  // The error paragraph mounts in the same commit as the message, so focus it
  // after render. Focusing from the handler would hit a ref that is still null
  // on the first failure.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (status === 'closing') return;

    setError('');

    // The lib repeats this guard; keeping it here means an empty submit never
    // reaches the network at all.
    if (!refCode.trim() || !closeKey.trim()) {
      setError(CLOSE_REPORT_NOT_FOUND_MESSAGE);
      return;
    }

    setStatus('closing');
    try {
      const closed = await closeLostReport({ refCode, closeKey });
      setResult(closed);
      setStatus('closed');
    } catch (closeError) {
      if (import.meta.env.DEV) console.error('[CloseLostReport]', closeError);
      setStatus('idle');
      // A transport failure is retryable and must not read as a bad link.
      setError(
        closeError?.code === 'network'
          ? closeError.message
          : CLOSE_REPORT_NOT_FOUND_MESSAGE,
      );
    }
  }

  const closing = status === 'closing';

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <SiteHeader />
        <main id="main" className="report-page">
          <Link className="back-link" to="/">
            <Icon name="arrow_back" />
            Back to search
          </Link>

          <div className="page-head">
            <h1 tabIndex={-1} ref={headingRef}>
              {status === 'closed' ? 'Report closed' : 'Close your lost report'}
            </h1>
            {status !== 'closed' && (
              <p className="lead">
                Found your item? Confirming below stops offices matching new
                items against your report and stops anyone contacting you about
                it.
              </p>
            )}
          </div>

          {status === 'closed' ? (
            <section
              className="state state--success"
              role="status"
              aria-labelledby={successTitleId}
            >
              <h2 className="state__title" id={successTitleId}>
                Your lost report is closed
              </h2>
              <p className="state__text">
                Offices will no longer match new items against this report or
                contact you about it. Your reference code is{' '}
                <strong>{result?.refCode ?? refCode}</strong>.
              </p>
              <p className="state__text">
                Opening this link again will not change anything.
              </p>
              <div className="state__actions">
                <Link className="btn btn--primary" to="/">
                  <Icon name="search" />
                  Search held items
                </Link>
              </div>
            </section>
          ) : (
            <form
              className="form"
              aria-label="Close a lost report"
              onSubmit={handleSubmit}
              noValidate
              aria-busy={closing}
            >
              <p className="form__legend form__legend--required">
                Fields marked * are required.
              </p>

              <div className="field">
                <FieldLabel htmlFor={refId} required>
                  Reference code
                </FieldLabel>
                <input
                  id={refId}
                  className="field__control"
                  type="text"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="LR-0100"
                  required
                  value={refCode}
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) => {
                    setRefCode(event.target.value);
                    if (error) setError('');
                  }}
                />
              </div>

              <div className="field">
                <FieldLabel htmlFor={keyId} required>
                  Private close key
                </FieldLabel>
                <input
                  id={keyId}
                  className="field__control field__control--mono"
                  type="text"
                  autoComplete="off"
                  spellCheck="false"
                  required
                  value={closeKey}
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? `${keyHintId} ${errorId}` : keyHintId}
                  onChange={(event) => {
                    setCloseKey(event.target.value);
                    if (error) setError('');
                  }}
                />
                <p className="field__hint" id={keyHintId}>
                  This is the long key in the private link from your receipt.
                  Opening this page does not close anything until you confirm.
                </p>
              </div>

              <div aria-live="polite">
                {error && (
                  <p
                    className="form-error"
                    id={errorId}
                    role="alert"
                    tabIndex={-1}
                    ref={errorRef}
                  >
                    <Icon name="error" />
                    <span>{error}</span>
                  </p>
                )}
              </div>

              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={closing}
                >
                  <Icon name="check_circle" />
                  {closing ? 'Closing report…' : 'Confirm Close Report'}
                </button>
              </div>
            </form>
          )}
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
