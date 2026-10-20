import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SearchPanel from '../components/SearchPanel.jsx';
import HowItWorks from '../components/HowItWorks.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import Icon from '../components/Icon.jsx';

export default function Landing() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <SiteHeader isHome />
        <main id="main" className="home">
          <div className="home__intro">
            <h1>Find what you lost.</h1>
            <p className="lead">
              Search items held at city office counters. No account needed.
            </p>
            <SearchPanel />
          </div>

          <section className="report-links" aria-labelledby="report-title">
            <h2 id="report-title">Lost or found something?</h2>
            <div className="link-list">
              <Link to="/report/lost">
                <span>Report a lost item</span>
                <Icon name="arrow_forward" />
              </Link>
              <Link to="/report/found">
                <span>Report a found item</span>
                <Icon name="arrow_forward" />
              </Link>
            </div>
          </section>

          <HowItWorks />
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
