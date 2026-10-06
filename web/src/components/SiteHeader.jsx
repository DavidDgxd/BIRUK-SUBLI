import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

export default function SiteHeader({ isHome = false }) {
  const Heading = isHome ? 'h1' : 'p';

  return (
    <header className="site-header">
      <Heading className="brand__name">
        {isHome ? (
          'Biruk-Subli'
        ) : (
          <Link className="brand__link" to="/">
            Biruk-Subli
          </Link>
        )}
      </Heading>
      <p className="brand__tagline">What&rsquo;s lost is found, safe and sound</p>
      <Link className="btn staff-link" to="/staff/login">
        <Icon name="person" />
        <span className="staff-link__text">
          <span>Staff/Admin</span>
          <span>Log in</span>
        </span>
      </Link>
    </header>
  );
}
