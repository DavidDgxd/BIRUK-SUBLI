import MistHero from '../components/MistHero.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import SearchPanel from '../components/SearchPanel.jsx';
import ReportCard from '../components/ReportCard.jsx';
import HowItWorks from '../components/HowItWorks.jsx';
import SiteFooter from '../components/SiteFooter.jsx';

export default function Landing() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <MistHero />
      <div className="page">
        <SiteHeader isHome />
        <main id="main" className="landing">
          <div className="landing__grid">
            <SearchPanel />
            <div className="report-stack">
              <ReportCard
                tone="lost"
                badgeIcon="contract_delete"
                title="Lost"
                description="Report Lost Items (Item Description, and optional contact information)"
                to="/report/lost"
                ctaIcon="description"
                ctaLabel="Report Lost Item"
              />
              <ReportCard
                tone="found"
                badgeIcon="package_2"
                title="Found"
                description="Report Found Items (Item description before surrendering)"
                to="/report/found"
                ctaIcon="package_2"
                ctaLabel="Report Found Item"
              />
            </div>
          </div>
          <HowItWorks />
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
