import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import LostReportForm from '../components/LostReportForm.jsx';
import Icon from '../components/Icon.jsx';

/* Public lost-item report page. Mounted at /report/lost. */
export default function ReportLost() {
  const headingRef = useRef(null);
  const [received, setReceived] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

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
              {received ? 'Report received' : 'Report a lost item'}
            </h1>
            {!received && (
              <p className="lead">
                Tell us what went missing. We will match it against items handed
                in at city counters. No account needed.
              </p>
            )}
          </div>

          <LostReportForm onReceiptChange={setReceived} />
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
