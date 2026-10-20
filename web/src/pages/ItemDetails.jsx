import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import Icon from '../components/Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';
import { fetchPublicItem } from '../lib/itemDetails.js';
import { releaseItemAtCounter } from '../lib/itemRelease.js';
import { transferItemCustody } from '../lib/itemTransfer.js';
import { listOffices } from '../lib/offices.js';
import { calibrateMatchScore } from '../lib/searchItems.js';

const ERROR_COPY = {
  'not-found':
    'We could not find that item. It may already have been released, or the link may be mistyped.',
  db: 'We could not load this item right now. Please try again.',
};

const TRANSFER_ERROR_COPY = {
  forbidden:
    'Only the office currently holding this item can transfer it. Sign in with that office and try again.',
  db: 'We could not update the holding office. Please try again.',
};

const RELEASE_ERROR_COPY = {
  validation:
    'Enter both the claimant name and the ID reference they presented.',
  forbidden:
    'Only the office currently holding this item can release it. Sign in with that office and try again.',
  duplicate:
    'This item has already been released. Its original claimant and release time were kept.',
  db: 'We could not release the item. Please try again.',
};

/** Intake date as "8 Oct 2026", or null when the value is missing or unparseable. */
function formatLoggedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/*
 * Standalone item detail page (US-18), mounted at /items/:id.
 *
 * US-18 asks for a result's photo, description and holding office. This page
 * shows the photo, the classification and the office to walk into, and says
 * what the desk will ask — but deliberately not items.description. That column
 * is the staff verification record (marks, serial numbers, condition) and was
 * hidden from the public in 8bb92fd so it could not be read here and recited at
 * the counter to pass the check. The photo is the claimant's evidence; the desk
 * check stays the proof.
 *
 * It loads the item by id rather than reading the result the searcher clicked,
 * so the page also works when opened directly, refreshed, or shared as a link.
 * The match percentage is the one thing that genuinely belongs to the search
 * that led here, so it is passed through router state and simply omitted when
 * there was no search.
 */
export default function ItemDetails() {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  const { office: staffOffice } = useStaffAuth();

  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState(null); // { key, item } or { key, error }
  const [imageFailed, setImageFailed] = useState(false);
  const [officeOptions, setOfficeOptions] = useState(null);
  const [officeError, setOfficeError] = useState('');
  const [selectedOfficeId, setSelectedOfficeId] = useState('');
  const [transferStatus, setTransferStatus] = useState('idle');
  const [transferError, setTransferError] = useState('');
  const [transferredTo, setTransferredTo] = useState('');
  const [claimantName, setClaimantName] = useState('');
  const [claimantIdRef, setClaimantIdRef] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [releaseStatus, setReleaseStatus] = useState('idle');
  const [releaseError, setReleaseError] = useState('');
  const [releasedTo, setReleasedTo] = useState('');
  const headingRef = useRef(null);
  const transferSelectId = useId();
  const releaseNameRef = useRef(null);
  const releaseIdRef = useRef(null);
  const releaseNameId = useId();
  const releaseIdFieldId = useId();
  const releaseNotesId = useId();

  // Identifies the fetch in flight, so a slow response for a previously viewed
  // item cannot overwrite the one now on screen.
  const key = `${id}|${attempt}`;

  useEffect(() => {
    const controller = new AbortController();

    fetchPublicItem(id, controller.signal)
      .then((item) => {
        if (!controller.signal.aborted) setOutcome({ key, item });
      })
      .catch((error) => {
        if (controller.signal.aborted || error.name === 'AbortError') return;
        setOutcome({ key, error });
      });

    return () => controller.abort();
  }, [id, key]);

  // Move focus to the heading when the page opens so screen readers start here.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // A photo that failed for one item must not leave the next one broken.
  useEffect(() => {
    setImageFailed(false);
  }, [id]);

  // Transfer and release feedback belongs to one item, not the next one opened.
  useEffect(() => {
    setSelectedOfficeId('');
    setTransferError('');
    setTransferredTo('');
    setTransferStatus('idle');
    setClaimantName('');
    setClaimantIdRef('');
    setReleaseNotes('');
    setReleaseError('');
    setReleaseStatus('idle');
    setReleasedTo('');
  }, [id]);

  const loading = outcome?.key !== key;
  const error = loading ? null : outcome.error;
  const item = loading ? null : (outcome.item ?? null);
  const holdingOfficeId = item?.holding_office_id ?? null;

  const canTransfer = Boolean(
    item &&
    staffOffice &&
    !releasedTo &&
    item.status === 'held' &&
    item.holding_office_id === staffOffice.id,
  );

  const canRelease = Boolean(
    item &&
    staffOffice &&
    !releasedTo &&
    item.status === 'held' &&
    item.holding_office_id === staffOffice.id,
  );

  useEffect(() => {
    if (!canTransfer) return undefined;

    const controller = new AbortController();
    let active = true;

    setOfficeError('');
    setOfficeOptions(null);

    listOffices({ signal: controller.signal })
      .then((rows) => {
        if (!active) return;
        setOfficeOptions(
          rows.filter(
            (row) => row.status === 'active' && row.id !== holdingOfficeId,
          ),
        );
      })
      .catch((loadError) => {
        if (!active || loadError.name === 'AbortError') return;
        if (import.meta.env.DEV) console.error('[ItemDetails]', loadError);
        setOfficeOptions([]);
        setOfficeError('We could not load the office list. Please try again.');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [canTransfer, holdingOfficeId]);

  async function handleTransfer(event) {
    event.preventDefault();
    if (!selectedOfficeId || transferStatus === 'saving') return;

    setTransferError('');
    setTransferStatus('saving');

    try {
      await transferItemCustody({
        itemId: item.id,
        newOfficeId: selectedOfficeId,
      });
      const target = officeOptions?.find(
        (option) => option.id === selectedOfficeId,
      );
      setTransferredTo(target?.name ?? 'The selected office');
      setSelectedOfficeId('');
      setTransferStatus('idle');
      setAttempt((n) => n + 1);
    } catch (transferFailure) {
      if (import.meta.env.DEV) console.error('[ItemDetails]', transferFailure);
      setTransferStatus('idle');
      setTransferError(
        TRANSFER_ERROR_COPY[transferFailure.code] ?? TRANSFER_ERROR_COPY.db,
      );
    }
  }

  async function handleRelease(event) {
    event.preventDefault();
    if (releaseStatus === 'saving') return;

    const cleanName = claimantName.trim();
    const cleanIdRef = claimantIdRef.trim();

    if (!cleanName) {
      setReleaseError("Enter the claimant's name.");
      releaseNameRef.current?.focus();
      return;
    }
    if (!cleanIdRef) {
      setReleaseError('Enter the ID reference presented by the claimant.');
      releaseIdRef.current?.focus();
      return;
    }

    setReleaseError('');
    setReleaseStatus('saving');

    try {
      const released = await releaseItemAtCounter({
        itemId: item.id,
        officeId: staffOffice.id,
        claimantName: cleanName,
        claimantIdRef: cleanIdRef,
        releaseNotes,
      });
      setReleasedTo(released.claimantName);
      setClaimantName('');
      setClaimantIdRef('');
      setReleaseNotes('');
      setReleaseStatus('idle');
    } catch (releaseFailure) {
      if (import.meta.env.DEV) console.error('[ItemDetails]', releaseFailure);
      setReleaseStatus('idle');
      setReleaseError(
        RELEASE_ERROR_COPY[releaseFailure.code] ?? RELEASE_ERROR_COPY.db,
      );
    }
  }

  const showImage = Boolean(item?.image_url) && !imageFailed;
  const logged = formatLoggedDate(item?.created_at);

  const similarity =
    typeof state?.similarity === 'number' ? state.similarity : null;
  const match = similarity === null ? null : calibrateMatchScore(similarity);

  /*
   * React Router records its position in the session history as `idx`, so a
   * value above 0 means a results page is behind this one in this tab — and
   * going back restores it exactly as it was, photo query and all, which a link
   * to /search could not (the uploaded photo lives only in history state).
   * A page opened in a fresh tab starts at 0 and has nothing to go back to.
   */
  const canGoBack =
    typeof window !== 'undefined' && (window.history.state?.idx ?? 0) > 0;

  const heldStatus = releasedTo
    ? 'Released'
    : item?.status === 'held'
      ? 'Held for collection'
      : item?.status;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <SiteHeader />
        <main id="main" className="item-page">
          {canGoBack ? (
            <button
              type="button"
              className="back-link back-link--button"
              onClick={() => navigate(-1)}
            >
              <Icon name="arrow_back" />
              Back to results
            </button>
          ) : (
            <Link className="back-link" to="/">
              <Icon name="arrow_back" />
              Back to search
            </Link>
          )}

          {loading && (
            <>
              <h1 className="visually-hidden">Item details</h1>
              <p className="loading" role="status">
                <Icon name="search" className="icon--pulse" />
                Loading item details…
              </p>
            </>
          )}

          {error?.code === 'not-found' && (
            <section className="state" role="status">
              <h1>Item not found</h1>
              <p className="state__text">{ERROR_COPY['not-found']}</p>
              {import.meta.env.DEV && (
                <p className="state__debug">{error.message}</p>
              )}
              <div className="state__actions">
                <Link className="btn btn--primary" to="/">
                  <Icon name="search" />
                  Search for your item
                </Link>
              </div>
            </section>
          )}

          {error && error.code !== 'not-found' && (
            <section className="state state--error" role="alert">
              <h1>Something went wrong</h1>
              <p className="state__text">
                {ERROR_COPY[error.code] ?? ERROR_COPY.db}
              </p>
              {import.meta.env.DEV && (
                <p className="state__debug">{error.message}</p>
              )}
              <div className="state__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  <Icon name="refresh" />
                  Try again
                </button>
                <Link className="btn btn--quiet" to="/">
                  <Icon name="search" />
                  Search for your item
                </Link>
              </div>
            </section>
          )}

          {item && (
            <>
              <div className="item-hero">
                <figure className="item-photo">
                  {showImage ? (
                    <img
                      src={item.image_url}
                      alt={`Photo of ${item.title}`}
                      width="800"
                      height="600"
                      decoding="async"
                      onError={() => setImageFailed(true)}
                    />
                  ) : (
                    <div
                      className="item-photo__empty"
                      role="img"
                      aria-label="No photo available"
                    >
                      <Icon name="hide_image" />
                    </div>
                  )}
                </figure>

                <div className="item-summary">
                  <p className="item-status">
                    <span className="dot" aria-hidden="true" />
                    {heldStatus}
                  </p>
                  <h1 tabIndex={-1} ref={headingRef}>
                    {item.title}
                  </h1>
                  <p className="item-meta">
                    {item.category}. Reference {item.ref_code}.
                    {logged && ` Logged ${logged}.`}
                    {match && ` ${match.percent}% search match.`}
                  </p>

                  {releasedTo && (
                    <p className="status-note" role="status">
                      <Icon name="check_circle" />
                      <span>
                        Released to {releasedTo}. The item is no longer visible
                        in public search.
                      </span>
                    </p>
                  )}

                  {transferredTo && !releasedTo && (
                    <p className="status-note" role="status">
                      <Icon name="check_circle" />
                      <span>
                        Custody updated. {transferredTo} now holds this item.
                      </span>
                    </p>
                  )}
                </div>
              </div>

              <div className="item-facts">
                <section aria-labelledby="held-at-title">
                  <h2 id="held-at-title">Held at</h2>
                  <div className="fact">
                    <p className="fact__name">{item.holding_office_name}</p>
                    <p>{item.office_address}</p>
                    <p>{item.counter_hours}</p>
                  </div>
                </section>

                <section aria-labelledby="before-title">
                  <h2 id="before-title">Before you go</h2>
                  <ul className="checklist">
                    <li>
                      <Icon name="check" />
                      <span>Bring a valid ID for the counter check.</span>
                    </li>
                    <li>
                      <Icon name="check" />
                      <span>
                        Be ready to describe unique marks, serial numbers or
                        condition.
                      </span>
                    </li>
                    <li>
                      <Icon name="check" />
                      <span>
                        Collect in person. There are no online claims or
                        delivery.
                      </span>
                    </li>
                  </ul>
                </section>
              </div>

              {(canRelease || canTransfer) && (
                <section className="staff-tools" aria-labelledby="staff-title">
                  <h2 id="staff-title">Staff controls</h2>
                  <p className="staff-tools__lead">
                    These controls update the custody record. They are only
                    shown to the office holding this item.
                  </p>

                  {canRelease && (
                    <form
                      className="staff-form"
                      aria-label="Release item to claimant"
                      onSubmit={handleRelease}
                    >
                      <h3>Release item to claimant</h3>
                      <p className="staff-tools__lead">
                        Confirm that the person at the counter presented a valid
                        ID. Recording the release removes the item from public
                        search and keeps the counter record traceable.
                      </p>

                      <div className="field">
                        <label className="field__label" htmlFor={releaseNameId}>
                          Claimant name
                        </label>
                        <input
                          id={releaseNameId}
                          ref={releaseNameRef}
                          className="field__control"
                          type="text"
                          value={claimantName}
                          onChange={(event) => {
                            setClaimantName(event.target.value);
                            setReleaseError('');
                          }}
                          autoComplete="off"
                          maxLength={200}
                          required
                          disabled={releaseStatus === 'saving'}
                          aria-invalid={
                            Boolean(releaseError) && !claimantName.trim()
                          }
                        />
                      </div>

                      <div className="field">
                        <label
                          className="field__label"
                          htmlFor={releaseIdFieldId}
                        >
                          ID reference
                        </label>
                        <input
                          id={releaseIdFieldId}
                          ref={releaseIdRef}
                          className="field__control"
                          type="text"
                          value={claimantIdRef}
                          onChange={(event) => {
                            setClaimantIdRef(event.target.value);
                            setReleaseError('');
                          }}
                          placeholder="e.g. UMID-4921"
                          autoComplete="off"
                          maxLength={100}
                          required
                          disabled={releaseStatus === 'saving'}
                          aria-invalid={
                            Boolean(releaseError) && !claimantIdRef.trim()
                          }
                        />
                        <p className="field__hint">
                          ID type and the last four characters only. Do not
                          record the full ID number.
                        </p>
                      </div>

                      <div className="field">
                        <label
                          className="field__label"
                          htmlFor={releaseNotesId}
                        >
                          Release notes
                          <span className="field__optional">Optional</span>
                        </label>
                        <textarea
                          id={releaseNotesId}
                          className="field__control field__control--area"
                          value={releaseNotes}
                          onChange={(event) =>
                            setReleaseNotes(event.target.value)
                          }
                          maxLength={1000}
                          disabled={releaseStatus === 'saving'}
                        />
                      </div>

                      <div aria-live="polite">
                        {releaseError && (
                          <p className="form-error">
                            <Icon name="error" />
                            {releaseError}
                          </p>
                        )}
                      </div>

                      <button
                        type="submit"
                        className="btn btn--primary"
                        disabled={releaseStatus === 'saving'}
                      >
                        <Icon
                          name={
                            releaseStatus === 'saving'
                              ? 'hourglass_top'
                              : 'assignment_turned_in'
                          }
                        />
                        {releaseStatus === 'saving'
                          ? 'Releasing…'
                          : 'Confirm release'}
                      </button>
                    </form>
                  )}

                  {canTransfer && (
                    <details className="staff-disclose">
                      <summary>Move item to another office</summary>
                      <form
                        className="staff-form"
                        aria-label="Update holding office"
                        onSubmit={handleTransfer}
                      >
                        <h3>Update holding office</h3>
                        <p className="staff-tools__lead">
                          Use this after physically moving the item to another
                          counter. It stays searchable and keeps its reference
                          code.
                        </p>

                        <div className="field">
                          <label
                            className="field__label"
                            htmlFor={transferSelectId}
                          >
                            New holding office
                          </label>
                          <select
                            id={transferSelectId}
                            className="field__control field__control--select"
                            value={selectedOfficeId}
                            onChange={(event) => {
                              setSelectedOfficeId(event.target.value);
                              setTransferError('');
                            }}
                            disabled={transferStatus === 'saving' || !officeOptions}
                            required
                          >
                            <option value="">
                              {officeOptions
                                ? 'Choose an office'
                                : 'Loading offices…'}
                            </option>
                            {officeOptions?.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div aria-live="polite">
                          {officeError && (
                            <p className="form-error">
                              <Icon name="error" />
                              {officeError}
                            </p>
                          )}
                          {transferError && (
                            <p className="form-error">
                              <Icon name="error" />
                              {transferError}
                            </p>
                          )}
                        </div>

                        <button
                          type="submit"
                          className="btn btn--primary"
                          disabled={
                            !selectedOfficeId ||
                            transferStatus === 'saving' ||
                            !officeOptions
                          }
                        >
                          <Icon
                            name={
                              transferStatus === 'saving'
                                ? 'hourglass_top'
                                : 'swap_horiz'
                            }
                          />
                          {transferStatus === 'saving'
                            ? 'Updating…'
                            : 'Update holding office'}
                        </button>
                      </form>
                    </details>
                  )}
                </section>
              )}
            </>
          )}
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
