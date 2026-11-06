import { useEffect, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import ResultCard from '../components/ResultCard.jsx';
import SearchFilters from '../components/SearchFilters.jsx';
import SearchPanel from '../components/SearchPanel.jsx';
import Icon from '../components/Icon.jsx';
import { listOfficeOptions } from '../lib/offices.js';
import { searchItems } from '../lib/searchItems.js';

const ERROR_COPY = {
  'ai-unreachable':
    'Search is temporarily unavailable. Please try again in a moment.',
  'ai-failed':
    'We could not search for that description. Try a few words instead.',
  'ai-bad-response': 'Search ran into a problem. Please try again.',
  db: 'We could not load results right now. Please try again.',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readDate(value) {
  return DATE_PATTERN.test(value ?? '') ? value : '';
}

function ResultList({ items, possible = false }) {
  return (
    <ul className="results__list">
      {items.map((item) => (
        <li key={item.id}>
          <ResultCard item={item} possible={possible} />
        </li>
      ))}
    </ul>
  );
}

function requestKey(q, color, photo, office, dateFrom, dateTo, attempt) {
  return [
    q,
    color,
    photo ? `${photo.name}:${photo.size}` : '',
    office,
    dateFrom,
    dateTo,
    attempt,
  ].join('|');
}

export default function SearchResults() {
  const [params] = useSearchParams();
  const { state: locationState } = useLocation();
  const navigate = useNavigate();
  const q = (params.get('q') ?? '').trim();
  const color = params.get('color') ?? '';
  const office = (params.get('office') ?? '').trim();
  const dateFrom = readDate(params.get('from'));
  const dateTo = readDate(params.get('to'));
  const photo =
    locationState?.photo instanceof File ? locationState.photo : null;
  const hasQuery = Boolean(q || photo);
  const hasFilters = Boolean(office || dateFrom || dateTo);

  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState(null); // { key, best, possible, state, translatedText } or { key, error }
  const [officeOptions, setOfficeOptions] = useState(null);
  const [focusToken, setFocusToken] = useState(0);
  const headingRef = useRef(null);

  useEffect(() => {
    if (!hasQuery) return undefined;
    const controller = new AbortController();
    const key = requestKey(q, color, photo, office, dateFrom, dateTo, attempt);

    searchItems({
      text: q,
      color,
      photo,
      office: office || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setOutcome({ key, ...result });
      })
      .catch((error) => {
        if (controller.signal.aborted || error.name === 'AbortError') return;
        setOutcome({ key, error });
      });

    return () => controller.abort();
  }, [hasQuery, q, color, photo, office, dateFrom, dateTo, attempt]);

  // The filter only needs the active offices' id and name. A failure leaves the
  // office select with "All offices"; the other filters and the search itself
  // still work.
  useEffect(() => {
    if (!hasQuery) return undefined;
    const controller = new AbortController();

    listOfficeOptions({ signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setOfficeOptions(rows);
      })
      .catch((error) => {
        if (controller.signal.aborted || error.name === 'AbortError') return;
        setOfficeOptions([]);
      });

    return () => controller.abort();
  }, [hasQuery]);

  function applyFilters(next) {
    const nextParams = new URLSearchParams(params);

    if (next.office) nextParams.set('office', next.office);
    else nextParams.delete('office');
    if (next.dateFrom) nextParams.set('from', next.dateFrom);
    else nextParams.delete('from');
    if (next.dateTo) nextParams.set('to', next.dateTo);
    else nextParams.delete('to');

    navigate(
      { pathname: '/search', search: nextParams.toString() },
      { replace: true, state: locationState },
    );
  }

  function clearFilters() {
    applyFilters({ office: '', dateFrom: '', dateTo: '' });
  }

  const loading =
    hasQuery &&
    outcome?.key !== requestKey(q, color, photo, office, dateFrom, dateTo, attempt);
  const error = !loading && outcome?.error;
  const best = !loading && !error && outcome?.best ? outcome.best : null;
  const possible =
    !loading && !error && outcome?.possible ? outcome.possible : null;
  const state = !loading && !error ? outcome?.state : null;
  const announcement =
    state === 'results'
      ? `${best.length} best ${best.length === 1 ? 'match' : 'matches'}${
          possible.length
            ? ` and ${possible.length} possible ${
                possible.length === 1 ? 'match' : 'matches'
              }`
            : ''
        } found.`
      : state === 'possible'
        ? `No confident match. Showing ${possible.length} possible ${
            possible.length === 1 ? 'match' : 'matches'
          }.`
        : state === 'none'
          ? 'No close match found.'
          : '';

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const translated =
    outcome?.translatedText &&
    outcome.translatedText.trim().toLowerCase() !== q.trim().toLowerCase()
      ? outcome.translatedText
      : null;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <SiteHeader />
        <main id="main" className="results">
          <div className="page-head">
            <h1 tabIndex={-1} ref={headingRef}>
              Search results
            </h1>
            {hasQuery && (
              <SearchPanel
                compact
                initialQuery={q}
                initialPhoto={photo}
                focusToken={focusToken}
              />
            )}
            {hasQuery && (color || photo) && (
              <p className="results__query">
                {color && `Color ${color}`}
                {color && photo && ' · '}
                {photo && 'Photo attached'}
              </p>
            )}
            {translated && (
              <p className="results__translated">
                Also searching for “{translated}”.
              </p>
            )}
          </div>

          {hasQuery && (
            <SearchFilters
              offices={officeOptions}
              office={office}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onApply={applyFilters}
              onClear={clearFilters}
            />
          )}

          {!hasQuery && (
            <section className="state">
              <h2 className="state__title">Nothing to search yet</h2>
              <p className="state__text">
                Describe your item, choose a color or add a photo to see which
                office is holding it.
              </p>
              <div className="state__actions">
                <Link className="btn btn--primary" to="/">
                  <Icon name="search" />
                  Start a search
                </Link>
              </div>
            </section>
          )}

          {loading && (
            <p className="loading" role="status">
              <Icon name="search" className="icon--pulse" />
              Searching the ledger…
            </p>
          )}

          {error && (
            <section className="state state--error" role="alert">
              <h2 className="state__title">Something went wrong</h2>
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
              </div>
            </section>
          )}

          <p className="visually-hidden" role="status">
            {announcement}
          </p>

          {state === 'results' && (
            <>
              <h2 className="results__heading">Best matches</h2>
              <p className="results__count">
                {best.length} {best.length === 1 ? 'match' : 'matches'}, best
                first
              </p>
              <ResultList items={best} />
              {possible.length > 0 && (
                <details className="more-matches">
                  <summary>Other possible matches ({possible.length})</summary>
                  <p className="state__text">
                    Weaker matches — check the details before claiming.
                  </p>
                  <ResultList items={possible} possible />
                </details>
              )}
            </>
          )}

          {state === 'possible' && (
            <section className="state" aria-labelledby="possible-matches">
              <h2 id="possible-matches" className="state__title">
                Possible matches
              </h2>
              <p className="state__text">
                We couldn&apos;t find a confident match in the held items. These
                are the closest, but they may not be yours.
              </p>
              <ResultList items={possible} possible />
            </section>
          )}

          {state === 'none' && (
            <section className="state">
              <h2 className="state__title">
                {hasFilters ? 'No items in that range' : 'No close match'}
              </h2>
              <p className="state__text">
                {hasFilters
                  ? 'No held item matches those filters. Try a wider date range or another office.'
                  : 'Nothing in the held inventory is close to that description. Try adding a colour, brand or size, or check back later — new items are added as they are handed in.'}
              </p>
              <div className="state__actions">
                {hasFilters && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={clearFilters}
                  >
                    <Icon name="close" />
                    Clear filters
                  </button>
                )}
                <button
                  type="button"
                  className={hasFilters ? 'btn' : 'btn btn--primary'}
                  onClick={() => setFocusToken((n) => n + 1)}
                >
                  <Icon name="search" />
                  Search again
                </button>
                {!hasFilters && (
                  <Link className="btn btn--quiet" to="/report/lost">
                    <Icon name="description" />
                    Report it lost
                  </Link>
                )}
              </div>
            </section>
          )}
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
