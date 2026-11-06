import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import OfficeDirectory from '../components/OfficeDirectory.jsx';
import Icon from '../components/Icon.jsx';

/* Public drop-off directory. Mounted at /offices (US-9). */
export default function Offices() {
  const headingRef = useRef(null);

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
        <main id="main" className="offices-page">
          <Link className="back-link" to="/">
            <Icon name="arrow_back" />
            Back to search
          </Link>

          <div className="page-head">
            <h1 tabIndex={-1} ref={headingRef}>
              Drop-off offices
            </h1>
            <p className="lead">
              Found something in Baguio? Bring it to any participating city
              office counter below. Staff will log it against your report.
            </p>
          </div>

          <OfficeDirectory
            title="Participating offices"
            intro="Open to the public during counter hours. No appointment is needed."
          />
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
