import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MistHero from '../components/MistHero.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import Icon from '../components/Icon.jsx';
import AddOfficeDialog from '../components/AddOfficeDialog.jsx';
import { listOffices } from '../lib/offices.js';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * Central admin: participating offices & logins (Wireframe Screen 20, US-01).
 *
 * Lists every office in the directory and opens the "+ ADD AN OFFICE" dialog to
 * provision a new one. The list is read through the anon-readable `offices`
 * SELECT policy; provisioning goes through the provision-office Edge Function.
 */
export default function AdminOffices() {
  const headingRef = useRef(null);
  const { isAuthenticated, session } = useStaffAuth();
  const [offices, setOffices] = useState(null); // null while the first load runs
  const [loadError, setLoadError] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoadError('');
    setOffices(null);
    listOffices({ signal: controller.signal })
      .then((rows) => {
        if (active) setOffices(rows);
      })
      .catch((loadErr) => {
        if (!active || loadErr.name === 'AbortError') return;
        if (import.meta.env.DEV) console.error('[AdminOffices]', loadErr);
        setOffices([]);
        setLoadError('We could not load the office directory right now.');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  function handleCreated() {
    setShowDialog(false);
    setReloadKey((key) => key + 1);
  }

  return (
    <>
      <MistHero />
      <div className="page">
        <SiteHeader />
        <main className="report-page">
          <Link className="results__back" to="/">
            <Icon name="arrow_back" />
            Back to search
          </Link>

          <h2 className="results__title" tabIndex={-1} ref={headingRef}>
            Participating offices
          </h2>
          <p className="report-page__lead">
            Provision shared logins and directory entries for the offices that
            hold found items.
          </p>

          {!isAuthenticated ? (
            <section className="state-card state-card--error" role="alert">
              <h3 className="state-card__title">Admin sign-in required</h3>
              <p className="state-card__text">
                Office provisioning is only available to the central admin.
              </p>
              <div className="state-card__actions">
                <Link className="btn btn--filled" to="/staff/login">
                  <Icon name="lock" />
                  Go to staff log in
                </Link>
              </div>
            </section>
          ) : (
            <>
              <div className="staff-bar">
                <span className="staff-bar__office">
                  <Icon name="admin_panel_settings" />
                  Central admin
                </span>
                <span className="staff-bar__meta">
                  <Icon name="badge" />
                  {session.staffEmail}
                </span>
                {session.isMock && (
                  <span className="staff-bar__badge">
                    Dev session &middot; not real auth
                  </span>
                )}
              </div>

              <section
                className="office-admin"
                aria-label="Participating offices"
              >
                <div className="office-admin__toolbar">
                  <button
                    type="button"
                    className="btn btn--filled"
                    onClick={() => setShowDialog(true)}
                  >
                    <Icon name="add" />
                    Add an office
                  </button>
                </div>

                {loadError ? (
                  <section
                    className="state-card state-card--error"
                    role="alert"
                  >
                    <h3 className="state-card__title">
                      Could not load offices
                    </h3>
                    <p className="state-card__text">{loadError}</p>
                    <div className="state-card__actions">
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
                  <p className="office-admin__empty" role="status">
                    Loading offices…
                  </p>
                ) : offices.length === 0 ? (
                  <p className="office-admin__empty">
                    No offices yet. Add the first one to start taking in found
                    items.
                  </p>
                ) : (
                  <div className="office-admin__table-wrap">
                    <table className="office-table">
                      <thead>
                        <tr>
                          <th scope="col">Office</th>
                          <th scope="col">Address</th>
                          <th scope="col">Counter hours</th>
                          <th scope="col">Contact</th>
                          <th scope="col">Status</th>
                          <th scope="col">Login</th>
                        </tr>
                      </thead>
                      <tbody>
                        {offices.map((office) => (
                          <tr key={office.id}>
                            <th scope="row" className="office-table__office">
                              <span className="office-table__name">
                                {office.name}
                              </span>
                              <span className="office-table__code">
                                {office.id}
                              </span>
                            </th>
                            <td>{office.address}</td>
                            <td>{office.counter_hours}</td>
                            <td>{office.phone_number || '—'}</td>
                            <td>
                              <span
                                className={`office-status office-status--${office.status}`}
                              >
                                {office.status === 'suspended'
                                  ? 'Suspended'
                                  : 'Active'}
                              </span>
                            </td>
                            <td>{office.auth_user_id ? 'Ready' : 'Pending'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>

      <AddOfficeDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onCreated={handleCreated}
      />
    </>
  );
}
