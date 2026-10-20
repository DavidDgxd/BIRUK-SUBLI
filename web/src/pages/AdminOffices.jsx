import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import StaffGate from '../components/StaffGate.jsx';
import StaffBar from '../components/StaffBar.jsx';
import Icon from '../components/Icon.jsx';
import AddOfficeDialog from '../components/AddOfficeDialog.jsx';
import ResetCredentialsDialog from '../components/ResetCredentialsDialog.jsx';
import OfficeActionsMenu from '../components/OfficeActionsMenu.jsx';
import { listOffices, listOfficeLogins } from '../lib/offices.js';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/** Suspension wins over login state: a suspended office cannot sign in either way. */
function accountStatus(office) {
  if (office.status === 'suspended') {
    return { key: 'suspended', label: 'Suspended' };
  }
  if (!office.auth_user_id) return { key: 'pending', label: 'Pending login' };
  return { key: 'ready', label: 'Ready' };
}

/*
 * Central admin: participating offices & logins (US-01/US-03).
 *
 * Lists every office, opens the add-office dialog to provision a new one, and
 * resets an office's shared login when it is reported lost or compromised.
 * Every write goes through an Edge Function that re-checks the caller's role.
 */
export default function AdminOffices() {
  const { status, isAdmin } = useStaffAuth();
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
    if (status !== 'authenticated' || !isAdmin) return undefined;

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
  }, [reloadKey, status, isAdmin]);

  function handleCreated() {
    setShowDialog(false);
    setReloadKey((key) => key + 1);
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <SiteHeader />
        <main id="main" className="admin-page">
          <Link className="back-link" to="/">
            <Icon name="arrow_back" />
            Back to search
          </Link>

          <div className="page-head">
            <h1 tabIndex={-1} ref={headingRef}>
              Participating offices
            </h1>
            <p className="lead">
              Provision shared logins for offices that hold found items, and
              reissue a login when one is lost or compromised.
            </p>
          </div>

          <h2 className="visually-hidden">Directory access</h2>
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

              <section className="office-admin" aria-label="Participating offices">
                <div className="admin-toolbar">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => setShowDialog(true)}
                  >
                    <Icon name="add" />
                    Add an office
                  </button>
                </div>

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
                    <div
                      className="office-table"
                      role="table"
                      aria-label="Participating offices and shared logins"
                    >
                      <div className="office-table__head" role="rowgroup">
                        <div className="office-table__row" role="row">
                          <div
                            role="columnheader"
                            className="office-table__cell office-table__office"
                          >
                            Office &amp; address
                          </div>
                          <div
                            role="columnheader"
                            className="office-table__cell office-table__hours"
                          >
                            Hours &amp; contact
                          </div>
                          <div
                            role="columnheader"
                            className="office-table__cell office-table__email"
                          >
                            Login email
                          </div>
                          <div
                            role="columnheader"
                            className="office-table__cell office-table__status"
                          >
                            Account status
                          </div>
                          <div
                            role="columnheader"
                            className="office-table__cell office-table__actions"
                          >
                            <span className="visually-hidden">Actions</span>
                          </div>
                        </div>
                      </div>
                      <div className="office-table__body" role="rowgroup">
                        {offices.map((office) => {
                          const account = accountStatus(office);
                          return (
                            <div key={office.id} className="office-table__row" role="row">
                              <div
                                role="rowheader"
                                className="office-table__cell office-table__office"
                              >
                                <span className="office-table__primary">
                                  {office.name}
                                </span>
                                <span className="office-table__meta">
                                  {office.address}
                                </span>
                              </div>
                              <div
                                role="cell"
                                className="office-table__cell office-table__hours"
                                data-label="Hours & contact"
                              >
                                <span className="office-table__primary">
                                  {office.counter_hours}
                                </span>
                                <span className="office-table__meta">
                                  {office.phone_number || '—'}
                                </span>
                              </div>
                              <div
                                role="cell"
                                className="office-table__cell office-table__email"
                                data-label="Login email"
                              >
                                {logins.get(office.id) ?? (
                                  <span className="office-table__none">
                                    Not provided
                                  </span>
                                )}
                              </div>
                              <div
                                role="cell"
                                className="office-table__cell office-table__status"
                                data-label="Account status"
                              >
                                <span
                                  className={`office-status office-status--${account.key}`}
                                >
                                  {account.label}
                                </span>
                              </div>
                              <div
                                role="cell"
                                className="office-table__cell office-table__actions"
                              >
                                <OfficeActionsMenu
                                  office={office}
                                  onReset={setResetTarget}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </>
          </StaffGate>
        </main>
        <SiteFooter />
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
