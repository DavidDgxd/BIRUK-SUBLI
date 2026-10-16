import { Link, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * The header's one staff link, picked from the session: "Log in" when signed
 * out, and a way back to the right dashboard when signed in. Nothing renders
 * while the session check is still loading, so neither link flashes up and
 * swaps, and nothing renders on the page the link would point to.
 */
function staffLinkFor(status, isAdmin) {
  if (status === 'unauthenticated') {
    return { to: '/staff/login', icon: 'person', lines: ['Staff/Admin', 'Log in'] };
  }
  if (status !== 'authenticated') return null;
  return isAdmin
    ? { to: '/admin/offices', icon: 'admin_panel_settings', lines: ['Admin', 'Dashboard'] }
    : { to: '/staff/intake', icon: 'dashboard', lines: ['Staff', 'Dashboard'] };
}

export default function SiteHeader({ isHome = false }) {
  const Heading = isHome ? 'h1' : 'p';
  const { status, isAdmin } = useStaffAuth();
  const { pathname } = useLocation();

  const link = staffLinkFor(status, isAdmin);
  const staffLink = link?.to === pathname ? null : link;

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
      {staffLink && (
        <Link className="btn staff-link" to={staffLink.to}>
          <Icon name={staffLink.icon} />
          <span className="staff-link__text">
            <span>{staffLink.lines[0]}</span>
            <span>{staffLink.lines[1]}</span>
          </span>
        </Link>
      )}
    </header>
  );
}
