import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SearchPanel from '../components/SearchPanel.jsx';
import HowItWorks from '../components/HowItWorks.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import ResultCard from '../components/ResultCard.jsx';
import Icon from '../components/Icon.jsx';
import { listRecentItems } from '../lib/publicItems.js';

export default function Landing() {
  const [recent, setRecent] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listRecentItems({ signal: controller.signal })
      .then((items) => {
        if (!controller.signal.aborted) setRecent(items);
      })
      .catch((error) => {
        if (controller.signal.aborted || error.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="landing-page">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell shell--landing">
        <SiteHeader isHome />
        <main id="main" className="home">
          <div className="home__intro">
            <h1>Find what you lost.</h1>
            <p className="lead">
              Official public registry for items held across Baguio City
              counters and stations. No account required.
            </p>
            <SearchPanel />
          </div>

          <div className="section-divider" aria-hidden="true">
            <span className="section-divider__mark" />
          </div>

          <section className="recent-items" aria-labelledby="recent-title">
            <div className="recent-items__head">
              <h2 id="recent-title">Recently handed in</h2>
              <Link className="btn btn--quiet" to="/browse">
                See all held items
                <Icon name="arrow_right_sharp" size={17} />
              </Link>
            </div>

            {!recent && !failed && (
              <p className="loading" role="status">
                Loading recent items&hellip;
              </p>
            )}
            {failed && (
              <p className="state__text" role="alert">
                We could not load recent items right now.
              </p>
            )}
            {recent?.length === 0 && (
              <p className="state__text">
                No items are being held right now.
              </p>
            )}
            {recent?.length > 0 && (
              <ul className="recent-items__list">
                {recent.map((item) => (
                  <li key={item.id}>
                    <ResultCard item={item} browse />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="section-divider" aria-hidden="true">
            <span className="section-divider__mark" />
          </div>

          <section className="report-links" aria-labelledby="report-title">
            <h2 id="report-title">Lost or found something?</h2>
            <div className="action-tiles">
              <Link className="action-tile action-tile--lost" to="/report/lost">
                <span className="action-tile__badge">
                  <Icon name="report_lost" size={22} strokeWidth={1.5} />
                </span>
                <span className="action-tile__body">
                  <span className="action-tile__title">Report a lost item</span>
                  <span className="action-tile__caption">
                    Left something behind? Log the details for counter matching.
                  </span>
                </span>
                <Icon
                  name="arrow_right_sharp"
                  className="action-tile__arrow"
                  size={20}
                  strokeWidth={1.5}
                />
              </Link>
              <Link
                className="action-tile action-tile--found"
                to="/report/found"
              >
                <span className="action-tile__badge">
                  <Icon name="report_found" size={22} strokeWidth={1.5} />
                </span>
                <span className="action-tile__body">
                  <span className="action-tile__title">
                    Report a found item
                  </span>
                  <span className="action-tile__caption">
                    Turned in property? Record it here for the owner.
                  </span>
                </span>
                <Icon
                  name="arrow_right_sharp"
                  className="action-tile__arrow"
                  size={20}
                  strokeWidth={1.5}
                />
              </Link>
            </div>
          </section>

          <div className="section-divider" aria-hidden="true">
            <span className="section-divider__mark" />
          </div>

          <HowItWorks />
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
