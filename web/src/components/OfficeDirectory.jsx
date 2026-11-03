import { useEffect, useId, useState } from 'react';
import Icon from './Icon.jsx';
import { listOffices, publicOffices } from '../lib/offices.js';

/*
 * Public directory of physical drop-off counters (US-9).
 *
 * Used by the standalone /offices page and the found-report receipt. The
 * `offices` table is readable by anonymous visitors through the "Offices are
 * viewable by everyone" policy, so no auth or RPC is needed.
 */
export default function OfficeDirectory({
  title = 'Participating drop-off offices',
  intro,
}) {
  const headingId = useId();
  const [offices, setOffices] = useState(null); // null while the first load runs
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setOffices(null);
    setLoadError('');
    listOffices({ signal: controller.signal })
      .then((rows) => {
        if (active) setOffices(publicOffices(rows));
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        if (import.meta.env.DEV) console.error('[OfficeDirectory]', error);
        setOffices([]);
        setLoadError('We could not load the office directory right now.');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  return (
    <section className="office-directory" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {intro && <p className="office-directory__lead">{intro}</p>}

      {loadError ? (
        <section className="state state--error" role="alert">
          <h3 className="state__title">Could not load offices</h3>
          <p className="state__text">{loadError}</p>
          <div className="state__actions">
            <button
              type="button"
              className="btn"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <Icon name="refresh" />
              Try again
            </button>
          </div>
        </section>
      ) : offices === null ? (
        <p className="loading" role="status">
          <Icon name="schedule" className="icon--pulse" />
          Loading offices…
        </p>
      ) : offices.length === 0 ? (
        <section className="state">
          <h3 className="state__title">No offices listed yet</h3>
          <p className="state__text">
            Participating counters will appear here as soon as they are added.
          </p>
        </section>
      ) : (
        <ul className="results__list office-directory__list">
          {offices.map((office) => (
            <li key={office.id}>
              <article className="result">
                <div className="result__no-photo" aria-hidden="true">
                  <Icon name="apartment" />
                </div>
                <div className="result__body">
                  <h3 className="result__title">{office.name}</h3>
                  <p className="result__office">{office.address}</p>
                  <p className="result__office office-directory__hours">
                    <Icon name="schedule" size={16} />
                    <span>{office.counter_hours}</span>
                  </p>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
