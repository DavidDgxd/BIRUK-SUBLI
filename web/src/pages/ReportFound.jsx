import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import FoundReportForm from '../components/FoundReportForm.jsx';
import Icon from '../components/Icon.jsx';

/* Public found-item report page. Mounted at /report/found. */
export default function ReportFound() {
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
              {received ? 'Report received' : 'Report a found item'}
            </h1>
            {!received && (
              <p className="lead">
                Found something in Baguio? Tell us what and where, then hand it
                in at a city office counter. No account needed.
              </p>
            )}
          </div>

          <FoundReportForm onReceiptChange={setReceived} />
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
