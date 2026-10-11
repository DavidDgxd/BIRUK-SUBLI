import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import MistHero from '../components/MistHero.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import StaffGate from '../components/StaffGate.jsx';
import StaffBar from '../components/StaffBar.jsx';
import StaffIntakeForm from '../components/StaffIntakeForm.jsx';
import Icon from '../components/Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * Staff counter intake page. Mounted at /staff/intake.
 *
 * The session comes from StaffAuthContext, which resolves the office's shared
 * login (US-02). StaffBar names the office the counter is filing against so the
 * officer can confirm they are at the right desk, and StaffGate keeps the form
 * behind that login.
 */
export default function StaffIntake() {
  const headingRef = useRef(null);
  const { office, session } = useStaffAuth();

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

          <StaffGate
            title="Staff sign-in required"
            message="This counter is only available to a signed-in office login."
            from="/staff/intake"
          >
            <>
              <StaffBar />
              <StaffIntakeForm
                office={office}
                staffEmail={session?.staffEmail}
              />
            </>
          </StaffGate>
        </main>
      </div>
    </>
  );
}
