import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import StaffGate from '../components/StaffGate.jsx';
import StaffBar from '../components/StaffBar.jsx';
import StaffIntakeForm from '../components/StaffIntakeForm.jsx';
import PendingSelfReports from '../components/PendingSelfReports.jsx';
import Icon from '../components/Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * Staff counter intake page. Mounted at /staff/intake. The session comes from
 * StaffAuthContext (the office's shared login); StaffBar names the office the
 * counter is filing against, and StaffGate keeps the form behind that login.
 */
export default function StaffIntake() {
  const headingRef = useRef(null);
  const { office, session } = useStaffAuth();
  const [prefillReport, setPrefillReport] = useState(null);
  const [reportsRefreshKey, setReportsRefreshKey] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function handleConverted() {
    setPrefillReport(null);
    setReportsRefreshKey((key) => key + 1);
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <SiteHeader />
        <main id="main" className="report-page">
          <Link className="back-link" to="/">
            <Icon name="arrow_back" />
            Back to search
          </Link>

          <div className="page-head">
            <h1 tabIndex={-1} ref={headingRef}>
              Log a found item
            </h1>
            <p className="lead">
              Record an item handed in at the counter. It becomes searchable
              immediately and stays in your office&rsquo;s custody until release.
            </p>
          </div>

          <h2 className="visually-hidden">Counter access</h2>
          <StaffGate
            title="Staff sign-in required"
            message="This counter is only available to a signed-in office login."
            deniedTitle="Counter logins only"
            deniedMessage="This counter files items against one office, and the central admin does not belong to one. Sign in with an office login to log items, or head back to the directory."
            from="/staff/intake"
          >
            <>
              <StaffBar />
              <div className="staff-intake">
                <PendingSelfReports
                  selectedId={prefillReport?.id}
                  onSelect={(report) => setPrefillReport({ ...report })}
                  refreshKey={reportsRefreshKey}
                />
                <StaffIntakeForm
                  office={office}
                  staffEmail={session?.staffEmail}
                  prefillReport={prefillReport}
                  onConverted={handleConverted}
                />
              </div>
            </>
          </StaffGate>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
