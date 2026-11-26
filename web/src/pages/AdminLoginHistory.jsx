import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import StaffGate from '../components/StaffGate.jsx';
import StaffBar from '../components/StaffBar.jsx';
import LoginHistoryPanel from '../components/LoginHistoryPanel.jsx';
import Icon from '../components/Icon.jsx';

/*
 * Central admin: login history (US-37).
 *
 * A full-page view of the same panel the office directory shows in its Login
 * history tab, so a link or a bookmark works without the directory first. The
 * RPC behind it re-checks the central-admin role; StaffGate only decides what
 * to draw.
 */
export default function AdminLoginHistory() {
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <SiteHeader />
        <main id="main" className="admin-page">
          <Link className="back-link" to="/admin/offices">
            <Icon name="arrow_back" />
            Back to offices
          </Link>

          <div className="page-head">
            <h1 tabIndex={-1} ref={headingRef}>
              Login history
            </h1>
            <p className="lead">
              Every office and central admin sign-in, newest first. A failed
              attempt carries no account details — only a coarse reason, so the
              log can never confirm whether an email exists.
            </p>
          </div>

          <StaffGate
            title="Admin sign-in required"
            message="Login history is only available to the central admin."
            deniedTitle="Central admin only"
            deniedMessage="This log covers every office, so only the central admin can read it. Your office login still works on the counter pages."
            requireAdmin
            from="/admin/login-history"
          >
            <>
              <StaffBar icon="admin_panel_settings" label="Central admin" />

              <section aria-label="Login history">
                <LoginHistoryPanel />
              </section>
            </>
          </StaffGate>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
