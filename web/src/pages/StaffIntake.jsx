import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import MistHero from '../components/MistHero.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import StaffIntakeForm from '../components/StaffIntakeForm.jsx';
import Icon from '../components/Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * Staff counter intake page. Mounted at /staff/intake.
 *
 * The session comes from StaffAuthContext, which currently hands a mock staff
 * session to development builds. The page renders the office it is logged into
 * so the counter officer can confirm they are filing against the right desk.
 */
export default function StaffIntake() {
  const headingRef = useRef(null);
  const { isAuthenticated, office, session } = useStaffAuth();

  // Move focus to the heading when the page opens so screen readers start here.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

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
            Log a found item into custody
          </h2>
          <p className="report-page__lead">
            Record an item handed in at the counter. It becomes searchable
            immediately and stays in your office&rsquo;s custody until it is
            released.
          </p>

          {isAuthenticated ? (
            <>
              <div className="staff-bar">
                <span className="staff-bar__office">
                  <Icon name="corporate_fare" />
                  {office.name}
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
              <StaffIntakeForm
                office={office}
                staffEmail={session.staffEmail}
              />
            </>
          ) : (
            <section className="state-card state-card--error" role="alert">
              <h3 className="state-card__title">Staff sign-in required</h3>
              <p className="state-card__text">
                This counter is only available to signed-in city staff.
              </p>
              <div className="state-card__actions">
                <Link className="btn btn--filled" to="/staff/login">
                  <Icon name="lock" />
                  Go to staff log in
                </Link>
              </div>
            </section>
          )}
        </main>
      </div>
    </>
  );
}
