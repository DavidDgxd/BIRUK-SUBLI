import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import MistHero from '../components/MistHero.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import LostReportForm from '../components/LostReportForm.jsx';
import Icon from '../components/Icon.jsx';

/* Public lost-item report page. Mounted at /report/lost. */
export default function ReportLost() {
  const headingRef = useRef(null);

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
            Report a lost item
          </h2>
          <p className="report-page__lead">
            Tell us what went missing and we will match it against items handed
            in at city office counters. You do not need an account.
          </p>

          <LostReportForm />
        </main>
      </div>
    </>
  );
}
