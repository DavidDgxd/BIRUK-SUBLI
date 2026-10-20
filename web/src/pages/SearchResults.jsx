import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import ResultCard from '../components/ResultCard.jsx';
import Icon from '../components/Icon.jsx';
import { searchItems } from '../lib/searchItems.js';

const ERROR_COPY = {
  'ai-unreachable':
    'Search is temporarily unavailable. Please try again in a moment.',
  'ai-failed':
    'We could not search for that description. Try a few words instead.',
  'ai-bad-response': 'Search ran into a problem. Please try again.',
  db: 'We could not load results right now. Please try again.',
};

function requestKey(q, color, photo, attempt) {
  return [q, color, photo ? `${photo.name}:${photo.size}` : '', attempt].join('|');
}

export default function SearchResults() {
  const [params] = useSearchParams();
  const { state } = useLocation();
  const q = (params.get('q') ?? '').trim();
  const color = params.get('color') ?? '';
  const photo = state?.photo instanceof File ? state.photo : null;
  const hasQuery = Boolean(q || photo);

  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState(null); // { key, items, translatedText } or { key, error }
  const headingRef = useRef(null);

  useEffect(() => {
    if (!hasQuery) return undefined;
    const controller = new AbortController();
    const key = requestKey(q, color, photo, attempt);

    searchItems({ text: q, color, photo, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setOutcome({ key, ...result });
      })
      .catch((error) => {
        if (controller.signal.aborted || error.name === 'AbortError') return;
        setOutcome({ key, error });
      });

    return () => controller.abort();
  }, [hasQuery, q, color, photo, attempt]);

  const loading =
    hasQuery && outcome?.key !== requestKey(q, color, photo, attempt);
  const error = !loading && outcome?.error;
  const primary = !loading && !error && outcome?.primary ? outcome.primary : null;
  const secondary =
    !loading && !error && outcome?.secondary ? outcome.secondary : null;
  const noMatches =
    primary && secondary && primary.length === 0 && secondary.length === 0;
  // Nothing cleared the confidence cutoff, but the drawer has candidates: lead
  // with the drawer open so the user is not shown an empty page.
  const onlySecondary =
    primary && secondary && primary.length === 0 && secondary.length > 0;

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
          <Link className="back-link" to="/">
            <Icon name="arrow_back" />
            New search
          </Link>

          <div className="page-head">
            <h1 tabIndex={-1} ref={headingRef}>
              Search results
            </h1>
            {hasQuery && (
              <p className="results__query">
                {q ? `“${q}”` : 'Photo search'}
                {color && `, color ${color}`}
                {photo && ', photo attached'}
              </p>
            )}
            {translated && (
              <p className="results__translated">
                Also searching for “{translated}”.
              </p>
            )}
          </div>

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

          {noMatches && (
            <section className="state" role="status">
              <h2 className="state__title">Nothing found yet</h2>
              <p className="state__text">
                No held item matches that. Try fewer words, add a color or a
                photo — or report your item so staff can watch for it.
              </p>
              <div className="state__actions">
                <Link className="btn btn--primary" to="/report/lost">
                  <Icon name="description" />
                  Report a lost item
                </Link>
                <Link className="btn btn--quiet" to="/">
                  <Icon name="search" />
                  Search again
                </Link>
              </div>
            </section>
          )}

          {primary && primary.length > 0 && (
            <>
              <p className="results__count" role="status">
                {primary.length} {primary.length === 1 ? 'match' : 'matches'},
                best first
              </p>
              <ul className="results__list">
                {primary.map((item) => (
                  <li key={item.id}>
                    <ResultCard item={item} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {secondary && secondary.length > 0 && (
            <details className="more-matches" open={onlySecondary}>
              <summary>Other possible matches ({secondary.length})</summary>
              {onlySecondary && (
                <p role="status">
                  No direct matches found. These are lower-confidence
                  possibilities.
                </p>
              )}
              <ul className="results__list">
                {secondary.map((item) => (
                  <li key={item.id}>
                    <ResultCard item={item} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
