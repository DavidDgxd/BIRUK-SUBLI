import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import MistHero from '../components/MistHero.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import Icon from '../components/Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';
import { fetchPublicItem } from '../lib/itemDetails.js';
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
  const headingRef = useRef(null);
  const transferSelectId = useId();

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

  // Transfer feedback belongs to one item, not the next one opened.
  useEffect(() => {
    setSelectedOfficeId('');
    setTransferError('');
    setTransferredTo('');
    setTransferStatus('idle');
  }, [id]);

  const loading = outcome?.key !== key;
  const error = loading ? null : outcome.error;
  const item = loading ? null : (outcome.item ?? null);
  const holdingOfficeId = item?.holding_office_id ?? null;

  const canTransfer = Boolean(
    item &&
    staffOffice &&
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

  return (
    <>
      <MistHero />
      <div className="page">
        <SiteHeader />
        <main className="report-page">
          {canGoBack ? (
            <button
              type="button"
              className="results__back results__back--button"
              onClick={() => navigate(-1)}
            >
              <Icon name="arrow_back" />
              Back to results
            </button>
          ) : (
            <Link className="results__back" to="/">
              <Icon name="arrow_back" />
              Back to search
            </Link>
          )}

          <h2 className="results__title" tabIndex={-1} ref={headingRef}>
            {item ? item.title : 'Item details'}
          </h2>

          {loading && (
            <div role="status">
              <p className="results__searching">
                <Icon name="search" className="icon--pulse" />
                Loading item details&hellip;
              </p>
              <div className="result-skeleton" aria-hidden="true" />
            </div>
          )}

          {error?.code === 'not-found' && (
            <section className="state-card" role="status">
              <h3 className="state-card__title">Item not found</h3>
              <p className="state-card__text">{ERROR_COPY['not-found']}</p>
              {import.meta.env.DEV && (
                <p className="state-card__debug">{error.message}</p>
              )}
              <div className="state-card__actions">
                <Link className="btn btn--filled" to="/">
                  <Icon name="search" />
                  Search for your item
                </Link>
              </div>
            </section>
          )}

          {error && error.code !== 'not-found' && (
            <section className="state-card state-card--error" role="alert">
              <h3 className="state-card__title">Something went wrong</h3>
              <p className="state-card__text">
                {ERROR_COPY[error.code] ?? ERROR_COPY.db}
              </p>
              {import.meta.env.DEV && (
                <p className="state-card__debug">{error.message}</p>
              )}
              <div className="state-card__actions">
                <button
                  type="button"
                  className="btn btn--filled"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  <Icon name="refresh" />
                  Try again
                </button>
                <Link className="btn" to="/">
                  <Icon name="search" />
                  Search for your item
                </Link>
              </div>
            </section>
          )}

          {item && (
            <>
              <p className="item-detail__meta">
                {match && (
                  <span
                    className={`item-detail__badge item-detail__badge--${match.tier}`}
                  >
                    {match.percent}% Match
                  </span>
                )}
                <span className="item-detail__ref">Ref {item.ref_code}</span>
                {logged && (
                  <span className="item-detail__ref">Logged {logged}</span>
                )}
              </p>

              <article className="item-detail">
                <div className="item-detail__media">
                  {showImage ? (
                    <img
                      src={item.image_url}
                      alt={`Photo of ${item.title}`}
                      onError={() => setImageFailed(true)}
                    />
                  ) : (
                    <div
                      className="item-detail__no-photo"
                      role="img"
                      aria-label="No photo available"
                    >
                      <Icon name="hide_image" />
                    </div>
                  )}
                </div>

                <div className="item-detail__content">
                  <p className="item-detail__category">
                    <Icon name="category" />
                    {item.category}
                  </p>

                  <p className="item-detail__verify">
                    <Icon name="verified_user" />
                    <span>
                      Bring a valid ID to the counter and be ready to describe
                      unique marks, serial numbers, or condition. The office
                      checks that against its own record before releasing the
                      item.
                    </span>
                  </p>

                  <div className="item-detail__office">
                    <p className="item-detail__office-name">
                      <Icon name="location_on" />
                      <span>
                        <span className="visually-hidden">Held at </span>
                        {item.holding_office_name}
                      </span>
                    </p>
                    <p className="item-detail__office-line">
                      <Icon name="map" />
                      <span>{item.office_address}</span>
                    </p>
                    <p className="item-detail__office-line">
                      <Icon name="schedule" />
                      <span>{item.counter_hours}</span>
                    </p>
                  </div>

                  {transferredTo && (
                    <p className="item-detail__transfer-note" role="status">
                      <Icon name="check_circle" />
                      <span>
                        Custody updated. {transferredTo} now holds this item.
                      </span>
                    </p>
                  )}

                  {canTransfer && (
                    <form
                      className="item-detail__transfer"
                      onSubmit={handleTransfer}
                    >
                      <h3 className="item-detail__transfer-title">
                        <Icon name="swap_horiz" />
                        Update holding office
                      </h3>
                      <p className="item-detail__transfer-lead">
                        Use this after physically moving the item to another
                        counter. It stays searchable and keeps its reference
                        code.
                      </p>

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

                      <div aria-live="polite">
                        {officeError && (
                          <p className="search__error">
                            <Icon name="error" />
                            {officeError}
                          </p>
                        )}
                        {transferError && (
                          <p className="search__error">
                            <Icon name="error" />
                            {transferError}
                          </p>
                        )}
                      </div>

                      <button
                        type="submit"
                        className="btn btn--filled"
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
                  )}
                </div>
              </article>
            </>
          )}
        </main>
      </div>
    </>
  );
}
