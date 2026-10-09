import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * Who the counter is filing as: the office login and the office it belongs to,
 * shown above the counter forms so the officer can check the desk before
 * logging anything.
 *
 * That login is shared and outlives a single shift, so the bar also ends the
 * session — the next officer starts from the login screen rather than inheriting
 * someone else's.
 */
export default function StaffBar({ icon = 'corporate_fare', label }) {
  const { session, signOut } = useStaffAuth();
  const navigate = useNavigate();
  const [signOutError, setSignOutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  if (!session) return null;

  async function handleSignOut() {
    if (signingOut) return;
    setSignOutError('');
    setSigningOut(true);
    try {
      await signOut();
      navigate('/staff/login', { replace: true });
    } catch (error) {
      // Still signed in — say so rather than pretending the shift ended.
      setSigningOut(false);
      setSignOutError(error?.message ?? 'We could not sign you out.');
    }
  }

  return (
    <div className="staff-bar">
      <span className="staff-bar__office">
        <Icon name={icon} />
        {label ?? session.officeName}
      </span>
      <span className="staff-bar__meta">
        <Icon name="badge" />
        {session.staffEmail}
      </span>
      <div className="staff-bar__actions">
        {session.isMock && (
          <span className="staff-bar__badge">Dev session &middot; not real auth</span>
        )}
        {signOutError && (
          <span className="staff-bar__note" role="alert">
            <Icon name="error" />
            {signOutError}
          </span>
        )}
        <button
          type="button"
          className="staff-bar__signout"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          <Icon name="logout" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
