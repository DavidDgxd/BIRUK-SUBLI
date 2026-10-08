import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import MistHero from '../components/MistHero.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import FoundReportForm from '../components/FoundReportForm.jsx';
import Icon from '../components/Icon.jsx';

/* Public found-item report page. Mounted at /report/found. */
export default function ReportFound() {
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
            Report a found item
          </h2>
          <p className="report-page__lead">
            Found something in Baguio? Tell us what and where, then hand it in
            at a city office counter. You do not need an account.
          </p>

          <FoundReportForm />
        </main>
      </div>
    </>
  );
}
