import { Link, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * Minimal site header: the wordmark and one session-aware staff link.
 * Nothing renders while the session check is loading, so neither link flashes
 * up and swaps, and the link is hidden on the page it would open.
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

  return (
    <header className="site-header">
      <Link className="site-header__brand" to="/">
        {isHome && (
          <Icon
            name="ledger_crest"
            className="site-header__crest"
            size={18}
            strokeWidth={1.5}
          />
        )}
        <span className="site-header__titles">
          <span className="site-header__name">Biruk-Subli</span>
          <span
            className={`site-header__place${
              isHome ? ' site-header__place--ledger' : ''
            }`}
          >
            {isHome ? 'BAGUIO CITY CIVIC LEDGER' : 'Baguio City lost & found'}
          </span>
        </span>
      </Link>
      {staffLink && (
        <Link className="site-header__staff" to={staffLink.to}>
          <Icon name={staffLink.icon} size={18} strokeWidth={1.5} />
          <span>{staffLink.label}</span>
        </Link>
      )}
    </header>
  );
}
