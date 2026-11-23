import { Link, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * Site header: the UB seal, university title and system line, with the
 * capstone's own name beneath them as a quiet credit. #125 dropped the
 * project name during the UB restyle, so keep this line: removing it again
 * loses the capstone's identity, while promoting it competes with the seal.
 * One offices link and one session-aware staff link. Nothing renders while
 * the session check is loading, so neither link flashes up and swaps, and
 * the link is hidden on the page it would open.
 */
function staffLinkFor(status, isAdmin) {
  if (status === 'unauthenticated') {
    return { to: '/staff/login', icon: 'person', label: 'Staff login' };
  }
  if (status !== 'authenticated') return null;
  return isAdmin
    ? { to: '/admin/offices', icon: 'admin_panel_settings', label: 'Admin' }
    : { to: '/staff/intake', icon: 'dashboard', label: 'Dashboard' };
}

export default function SiteHeader({ isHome = false }) {
  const { status, isAdmin } = useStaffAuth();
  const { pathname } = useLocation();

  const link = staffLinkFor(status, isAdmin);
  const staffLink = link?.to === pathname ? null : link;
  const officesLink =
    pathname === '/offices'
      ? null
      : { to: '/offices', icon: 'location_on', label: 'Offices' };

  return (
    <header className="site-header">
      <Link className="site-header__brand" to="/">
        {/* Official University of Baguio seal, used as shipped. The alt is
            empty because the titles beside it name the university. */}
        <img
          className="site-header__seal"
          src="/assets/ub/ub-seal.png"
          alt=""
          width="40"
          height="40"
          decoding="async"
        />
        <span className="site-header__titles">
          <span className="site-header__name">University of Baguio</span>
          <span
            className={`site-header__place${
              isHome ? ' site-header__place--ledger' : ''
            }`}
          >
            Lost &amp; Found System
          </span>
          <span className="site-header__tagline">Biruk-Subli</span>
        </span>
      </Link>
      <nav className="site-header__nav" aria-label="Site">
        {officesLink && (
          <Link className="site-header__link" to={officesLink.to}>
            <Icon name={officesLink.icon} size={18} strokeWidth={1.5} />
            <span>{officesLink.label}</span>
          </Link>
        )}
        {staffLink && (
          <Link className="site-header__link" to={staffLink.to}>
            <Icon name={staffLink.icon} size={18} strokeWidth={1.5} />
            <span>{staffLink.label}</span>
          </Link>
        )}
      </nav>
    </header>
  );
}
