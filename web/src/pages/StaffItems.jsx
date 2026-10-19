import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MistHero from '../components/MistHero.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import StaffGate from '../components/StaffGate.jsx';
import StaffBar from '../components/StaffBar.jsx';
import Icon from '../components/Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';
import { listHeldItems } from '../lib/staffItems.js';

function formatReceivedDate(value) {
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
 * Staff held-items list (US-31), mounted at /staff/items.
 *
 * The counter needs a way to find an item already in its custody without
 * searching the public catalogue or typing an item URL. The list is scoped to
 * the signed-in office and to status 'held', and each row opens the existing
 * item detail page.
 */
export default function StaffItems() {
  const headingRef = useRef(null);
  const { office } = useStaffAuth();

  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!office) return undefined;

    const controller = new AbortController();
    let active = true;

    setItems(null);
    setLoadError('');

    listHeldItems({ officeId: office.id, signal: controller.signal })
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        if (import.meta.env.DEV) console.error('[StaffItems]', error);
        setItems([]);
        setLoadError('We could not load your held items right now.');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [office, reloadKey]);

  const loading = Boolean(office) && items === null;

  return (
    <>
      <MistHero />
      <div className="page">
        <SiteHeader />
        <main className="report-page">
          <Link className="results__back" to="/staff/intake">
            <Icon name="arrow_back" />
            Back to intake
          </Link>

          <h2 className="results__title" tabIndex={-1} ref={headingRef}>
            Items held at your office
          </h2>
          <p className="report-page__lead">
            Every item currently in your office&rsquo;s custody. Open one to
            transfer it to another counter or check its details.
          </p>

          <StaffGate
            title="Staff sign-in required"
            message="Your office's held items are only visible to a signed-in office login."
            deniedTitle="Counter logins only"
            deniedMessage="Items are listed against one office. Sign in with an office login to see its held items."
            from="/staff/items"
          >
            <>
              <StaffBar />

              {loadError && (
                <section className="state-card state-card--error" role="alert">
                  <h3 className="state-card__title">
                    Could not load held items
                  </h3>
                  <p className="state-card__text">{loadError}</p>
                  <div className="state-card__actions">
                    <button
                      type="button"
                      className="btn btn--filled"
                      onClick={() => setReloadKey((key) => key + 1)}
                    >
                      <Icon name="refresh" />
                      Try again
                    </button>
                  </div>
                </section>
              )}

              {loading && (
                <p className="staff-gate__checking" role="status">
                  <Icon name="hourglass_top" />
                  Loading held items&hellip;
                </p>
              )}

              {!loading && !loadError && items?.length === 0 && (
                <section className="state-card" role="status">
                  <h3 className="state-card__title">No items held right now</h3>
                  <p className="state-card__text">
                    Items logged at your counter will appear here until they are
                    released or transferred.
                  </p>
                  <div className="state-card__actions">
                    <Link className="btn btn--filled" to="/staff/intake">
                      <Icon name="add_box" />
                      Log an item
                    </Link>
                  </div>
                </section>
              )}

              {!loading && !loadError && items?.length > 0 && (
                <section
                  className="staff-items"
                  aria-label={`Items held at ${office?.name}`}
                >
                  <p className="results__count" role="status">
                    {items.length} held {items.length === 1 ? 'item' : 'items'}
                  </p>
                  <ul className="staff-items__list">
                    {items.map((item) => (
                      <li key={item.id}>
                        <Link className="staff-item" to={`/items/${item.id}`}>
                          <span className="staff-item__head">
                            <span className="staff-item__title">
                              {item.title}
                            </span>
                            <Icon name="chevron_right" />
                          </span>
                          <span className="staff-item__meta">
                            <span className="staff-item__ref">
                              {item.ref_code}
                            </span>
                            <span>{item.category}</span>
                            {formatReceivedDate(item.date_received) && (
                              <span>
                                Received{' '}
                                {formatReceivedDate(item.date_received)}
                              </span>
                            )}
                          </span>
                          {item.storage_location && (
                            <span className="staff-item__storage">
                              <Icon name="inventory_2" />
                              {item.storage_location}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          </StaffGate>
        </main>
      </div>
    </>
  );
}
