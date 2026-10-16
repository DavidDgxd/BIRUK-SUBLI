import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MistHero from '../components/MistHero.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import StaffGate from '../components/StaffGate.jsx';
import StaffBar from '../components/StaffBar.jsx';
import Icon from '../components/Icon.jsx';
import AddOfficeDialog from '../components/AddOfficeDialog.jsx';
import ResetCredentialsDialog from '../components/ResetCredentialsDialog.jsx';
import OfficeActionsMenu from '../components/OfficeActionsMenu.jsx';
import { listOffices, listOfficeLogins } from '../lib/offices.js';

/** Suspension wins over login state: a suspended office cannot sign in either way. */
function accountStatus(office) {
  if (office.status === 'suspended') {
    return { key: 'suspended', label: 'Suspended' };
  }
  if (!office.auth_user_id) return { key: 'pending', label: 'Pending login' };
  return { key: 'ready', label: 'Ready' };
}

/*
 * Central admin: participating offices & logins (Wireframe Screen 20, US-01/US-03).
 *
 * Lists every office in the directory, opens the "+ ADD AN OFFICE" dialog to
 * provision a new one, and resets an office's shared login when it is reported
 * lost or compromised. The list is read through the anon-readable `offices`
 * SELECT policy; every write goes through an Edge Function that re-checks the
 * caller's central-admin role.
 */
export default function AdminOffices() {
  const headingRef = useRef(null);
  const [offices, setOffices] = useState(null); // null while the first load runs
  const [logins, setLogins] = useState(() => new Map()); // office id → login email
  const [loadError, setLoadError] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoadError('');
    setOffices(null);
    Promise.all([
      listOffices({ signal: controller.signal }),
      // Login emails are a nice-to-have: if they cannot be read, the table
      // still lists every office, just without the address.
      listOfficeLogins({ signal: controller.signal }).catch((loginErr) => {
        if (import.meta.env.DEV) console.warn('[AdminOffices]', loginErr);
        return new Map();
      }),
    ])
      .then(([rows, emails]) => {
        if (!active) return;
        setOffices(rows);
        setLogins(emails);
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
            hold found items, and reissue a login when one is reported lost or
            compromised.
          </p>

          <StaffGate
            title="Admin sign-in required"
            message="Office provisioning is only available to the central admin."
            deniedTitle="Central admin only"
            deniedMessage="This directory is managed by the central admin. Your office login still works on the counter pages."
            requireAdmin
            from="/admin/offices"
          >
            <>
              <StaffBar icon="admin_panel_settings" label="Central admin" />

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
                          <th scope="col">Office &amp; address</th>
                          <th scope="col">Hours &amp; contact</th>
                          <th scope="col">Login email</th>
                          <th scope="col">Account status</th>
                          <th scope="col" className="office-table__actions">
                            <span className="visually-hidden">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {offices.map((office) => {
                          const status = accountStatus(office);
                          return (
                            <tr key={office.id}>
                              <th scope="row" className="office-table__office">
                                <span className="office-table__primary">
                                  {office.name}
                                </span>
                                <span className="office-table__meta">
                                  {office.address}
                                </span>
                              </th>
                              <td
                                className="office-table__hours"
                                data-label="Hours & contact"
                              >
                                <span className="office-table__primary">
                                  {office.counter_hours}
                                </span>
                                <span className="office-table__meta">
                                  {office.phone_number || '—'}
                                </span>
                              </td>
                              <td
                                className="office-table__email"
                                data-label="Login email"
                              >
                                {logins.get(office.id) ?? (
                                  <span className="office-table__none">
                                    Not provided
                                  </span>
                                )}
                              </td>
                              <td
                                className="office-table__status"
                                data-label="Account status"
                              >
                                <span
                                  className={`office-status office-status--${status.key}`}
                                >
                                  {status.label}
                                </span>
                              </td>
                              <td className="office-table__actions">
                                <OfficeActionsMenu
                                  office={office}
                                  onReset={setResetTarget}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          </StaffGate>
        </main>
      </div>

      <AddOfficeDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onCreated={handleCreated}
      />

      <ResetCredentialsDialog
        open={resetTarget !== null}
        office={resetTarget}
        onClose={() => setResetTarget(null)}
      />
    </>
  );
}
