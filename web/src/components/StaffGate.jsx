import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * Gate for the counter pages and the central-admin directory.
 *
 * By default the children render only for a signed-in *office* login. Counter
 * pages file against an office id, so a session that authenticates without one
 * — the central admin's — does not qualify. `requireAdmin` flips the test the
 * other way for /admin/offices, where the role is the requirement and an
 * ordinary office login is not enough.
 *
 * This is a UI gate, not a security boundary: the role is re-checked on the
 * server for every admin action.
 *
 * While a stored session is still being resolved the space is held, and a
 * visitor who does not qualify is told why and given somewhere to go rather
 * than a blank page. `from` is the page to come back to once they have signed
 * in, so a blocked visit resumes where it left off.
 */
export default function StaffGate({
  title,
  message,
  deniedTitle,
  deniedMessage,
  requireAdmin = false,
  from,
  children,
}) {
  const { isAuthenticated, isAdmin, office, status } = useStaffAuth();

  if (status === 'loading') {
    return (
      <p className="staff-gate__checking" role="status">
        <Icon name="hourglass_top" />
        Checking your session…
      </p>
    );
  }

  if (!isAuthenticated) {
    return (
      <section className="state-card state-card--error" role="alert">
        <h3 className="state-card__title">{title}</h3>
        <p className="state-card__text">{message}</p>
        <div className="state-card__actions">
          <Link className="btn btn--filled" to="/staff/login" state={{ from }}>
            <Icon name="lock" />
            Go to staff log in
          </Link>
        </div>
      </section>
    );
  }

  // Signed in, but as the wrong kind of caller for this page.
  const qualifies = requireAdmin ? isAdmin : Boolean(office);
  if (!qualifies) {
    // Send them somewhere they can actually work: an office login blocked from
    // the admin directory belongs at the counter, and a central admin who has
    // no office of their own belongs in the directory.
    const fallback = requireAdmin
      ? { to: '/staff/intake', icon: 'point_of_sale', label: 'Go to the counter' }
      : { to: '/admin/offices', icon: 'admin_panel_settings', label: 'Go to central admin' };

    return (
      <section className="state-card state-card--error" role="alert">
        <h3 className="state-card__title">{deniedTitle ?? title}</h3>
        <p className="state-card__text">{deniedMessage ?? message}</p>
        <div className="state-card__actions">
          <Link className="btn" to={fallback.to}>
            <Icon name={fallback.icon} />
            {fallback.label}
          </Link>
        </div>
      </section>
    );
  }

  return children;
}
