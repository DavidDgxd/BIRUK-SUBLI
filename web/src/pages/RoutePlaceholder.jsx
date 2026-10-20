import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import Icon from '../components/Icon.jsx';

/* Simple page for an unknown route, with one way back into the service. */
export default function RoutePlaceholder({
  title,
  message = 'This page is coming soon.',
}) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <SiteHeader />
        <main id="main" className="state-page">
          <h1>{title}</h1>
          <p className="state-page__text">{message}</p>
          <Link className="btn btn--primary" to="/">
            <Icon name="arrow_back" />
            Back to search
          </Link>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
