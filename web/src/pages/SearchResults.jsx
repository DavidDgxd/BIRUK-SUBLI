import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import MistHero from '../components/MistHero.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import ResultCard from '../components/ResultCard.jsx';
import Icon from '../components/Icon.jsx';
import { searchItems } from '../lib/searchItems.js';

const SKELETON_COUNT = 3;

const ERROR_COPY = {
  'ai-unreachable': 'Search is temporarily unavailable. Please try again in a moment.',
  'ai-failed': 'Search ran into a problem. Please try again.',
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

  const loading = hasQuery && outcome?.key !== requestKey(q, color, photo, attempt);
  const error = !loading && outcome?.error;
  const items = !loading && !error && outcome?.items ? outcome.items : null;

  // Move focus to the heading when the page opens so screen readers start at the results.
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
      <MistHero />
      <div className="page">
        <SiteHeader />
        <main className="results">
          <Link className="results__back" to="/">
            <Icon name="arrow_back" />
            New search
          </Link>

          <h2 className="results__title" tabIndex={-1} ref={headingRef}>
            Search results
          </h2>

          {hasQuery && (
            <ul className="results__summary" aria-label="Your search">
              {q && (
                <li className="summary-chip">
                  <Icon name="search" />
                  {q}
                </li>
              )}
              {color && (
                <li className="summary-chip">
                  <Icon name="palette" />
                  {color}
                </li>
              )}
              {photo && (
                <li className="summary-chip">
                  <Icon name="photo_camera" />
                  Photo attached
                </li>
              )}
            </ul>
          )}

          {translated && (
            <p className="results__translated">
              Searching for &ldquo;{translated}&rdquo; (translated from your Filipino text).
            </p>
          )}

          {!hasQuery && (
            <section className="state-card">
              <h3 className="state-card__title">Nothing to search yet</h3>
              <p className="state-card__text">
                Describe your item or upload a photo to see which office is holding it.
              </p>
              <Link className="btn btn--filled" to="/">
                <Icon name="search" />
                Start a search
              </Link>
            </section>
          )}

          {loading && (
            <div role="status" aria-live="polite">
              <p className="visually-hidden">Searching for your item&hellip;</p>
              <ul className="results__list" aria-hidden="true">
                {Array.from({ length: SKELETON_COUNT }, (_, i) => (
                  <li key={i} className="result-skeleton" />
                ))}
              </ul>
            </div>
          )}

          {error && (
            <section className="state-card state-card--error" role="alert">
              <h3 className="state-card__title">Something went wrong</h3>
              <p className="state-card__text">{ERROR_COPY[error.code] ?? ERROR_COPY.db}</p>
              {import.meta.env.DEV && <p className="state-card__debug">{error.message}</p>}
              <button
                type="button"
                className="btn btn--filled"
                onClick={() => setAttempt((n) => n + 1)}
              >
                <Icon name="refresh" />
                Try again
              </button>
            </section>
          )}

          {items && items.length === 0 && (
            <section className="state-card" role="status">
              <h3 className="state-card__title">Walang nakita (nothing found)</h3>
              <p className="state-card__text">
                No held item matches that yet. Try fewer words, add a color, or upload a photo.
                New items are logged at the counters every day, and you can report your item
                so staff can watch for it.
              </p>
              <div className="state-card__actions">
                <Link className="btn btn--filled" to="/report/lost">
                  <Icon name="description" />
                  Report Lost Item
                </Link>
                <Link className="btn" to="/">
                  <Icon name="search" />
                  Search again
                </Link>
              </div>
            </section>
          )}

          {items && items.length > 0 && (
            <>
              <p className="results__count" role="status">
                {items.length} possible {items.length === 1 ? 'match' : 'matches'}, best first
              </p>
              <ul className="results__list">
                {items.map((item) => (
                  <li key={item.id}>
                    <ResultCard item={item} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </main>
      </div>
    </>
  );
}
