import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
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
 * Items held by the signed-in office (US-31), mounted at /staff/items.
 *
 * The counter needs a way to find something already in its custody without
 * going through the public search or remembering an item URL. The list is
 * scoped to the office session, and each row opens the existing item detail
 * page where the officer can transfer custody or record a release.
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
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <SiteHeader />
        <main id="main" className="results">
          <Link className="back-link" to="/staff/intake">
            <Icon name="arrow_back" />
            Back to intake
          </Link>

          <div className="page-head">
            <h1 tabIndex={-1} ref={headingRef}>
              Items held at your office
            </h1>
            <p className="lead">
              Every item currently in your office&rsquo;s custody. Open one to
              transfer it to another counter or record its release.
            </p>
          </div>

          <h2 className="visually-hidden">Counter access</h2>
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
                <section className="state state--error" role="alert">
                  <h3 className="state__title">Could not load held items</h3>
                  <p className="state__text">{loadError}</p>
                  <div className="state__actions">
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => setReloadKey((key) => key + 1)}
                    >
                      <Icon name="refresh" />
                      Try again
                    </button>
                  </div>
                </section>
              )}

              {loading && (
                <p className="loading" role="status">
                  <Icon name="hourglass_top" className="icon--pulse" />
                  Loading held items…
                </p>
              )}

              {!loading && !loadError && items?.length === 0 && (
                <section className="state" role="status">
                  <h3 className="state__title">No items held right now</h3>
                  <p className="state__text">
                    Items logged at your counter will appear here until they are
                    released or transferred.
                  </p>
                  <div className="state__actions">
                    <Link className="btn btn--primary" to="/staff/intake">
                      <Icon name="add_box" />
                      Log an item
                    </Link>
                  </div>
                </section>
              )}

              {!loading && !loadError && items?.length > 0 && (
                <section
                  className="staff-items"
                  aria-label={`Items held at ${office?.name ?? 'your office'}`}
                >
                  <p className="results__count" role="status">
                    {items.length} held {items.length === 1 ? 'item' : 'items'}
                  </p>
                  <ul className="staff-items__list">
                    {items.map((item) => (
                      <li key={item.id}>
                        <Link className="staff-item" to={`/items/${item.id}`}>
                          <span className="staff-item__body">
                            <span className="staff-item__title">
                              {item.title}
                            </span>
                            <span className="staff-item__meta">
                              <span className="staff-item__ref">
                                {item.ref_code}
                              </span>
                              {item.category && <span>{item.category}</span>}
                              {formatReceivedDate(item.date_received) && (
                                <span>
                                  Received{' '}
                                  {formatReceivedDate(item.date_received)}
                                </span>
                              )}
                            </span>
                            {item.storage_location && (
                              <span className="staff-item__storage">
                                <Icon name="inventory_2" size={16} />
                                {item.storage_location}
                              </span>
                            )}
                          </span>
                          <Icon
                            name="chevron_right"
                            className="staff-item__chevron"
                            size={18}
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          </StaffGate>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
