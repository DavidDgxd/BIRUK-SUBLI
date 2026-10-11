import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * Gate for the counter pages. Children render only for a signed-in office
 * login: while a stored session is still being resolved the space is held, and
 * with no session the page explains the block and offers the login screen.
 *
 * `from` is the page to come back to once the officer has signed in, so a
 * blocked visit resumes where it left off instead of dumping them on intake.
 */
export default function StaffGate({ title, message, from, children }) {
  const { isAuthenticated, status } = useStaffAuth();

  if (status === 'loading') {
    return (
      <p className="staff-gate__checking" role="status">
        <Icon name="hourglass_top" />
        Checking your office session…
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

  return children;
}
