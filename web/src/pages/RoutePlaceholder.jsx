import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import MistHero from '../components/MistHero.jsx';
import Icon from '../components/Icon.jsx';

/* Temporary page for routes that are linked from the landing page but not built yet. */
export default function RoutePlaceholder({
  title,
  message = 'This page is coming soon.',
}) {
  return (
    <>
      <MistHero />
      <div className="page">
        <SiteHeader />
        <main className="placeholder">
          <h2 className="placeholder__title">{title}</h2>
          <p className="placeholder__text">{message}</p>
          <Link className="btn btn--filled" to="/">
            <Icon name="arrow_back" />
            Back to home
          </Link>
        </main>
      </div>
    </>
  );
}
