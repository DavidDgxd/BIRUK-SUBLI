import { useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import Icon from '../components/Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * Office log in (US-02), and the central admin's way in (US-03). Mounted at
 * /staff/login. One set of credentials per office, issued by the central admin,
 * so whoever is on the counter that day can sign in without a personal account.
 */
export default function StaffLogin() {
  const { isAuthenticated, isAdmin, signIn } = useStaffAuth();
  const location = useLocation();

  const headingRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  // Where the officer was headed before the gate sent them here. Only a path
  // within this app is honoured, never an absolute URL.
  const requested = location.state?.from;
  const requestedPath =
    typeof requested === 'string' && requested.startsWith('/')
      ? requested
      : null;

  // The central admin belongs in the office directory — they have no office of
  // their own to file against — so the counter is not a destination for them.
  const from = requestedPath ?? (isAdmin ? '/admin/offices' : '/staff/intake');

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const siteEmail = email.trim();
    if (!siteEmail) {
      setError('Enter your office’s site email.');
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setError('Enter the site password.');
      passwordRef.current?.focus();
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await signIn(siteEmail, password);
      // The provider flips isAuthenticated, which renders the redirect below.
    } catch (signInError) {
      if (import.meta.env.DEV) console.error('[StaffLogin]', signInError);
      setSubmitting(false);
      setError(
        signInError?.message ??
          'We could not sign you in right now. Please try again.',
      );
      passwordRef.current?.focus();
    }
  }

  if (isAuthenticated) return <Navigate to={from} replace />;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <SiteHeader />
        <main id="main" className="auth-page">
          <Link className="back-link" to="/">
            <Icon name="arrow_back" />
            Back to search
          </Link>

          <div className="page-head">
            <h1 tabIndex={-1} ref={headingRef}>
              Office sign in
            </h1>
            <p className="lead">
              Counter staff use the shared credentials issued to their office.
              The central admin signs in here too.
            </p>
          </div>

          <form
            className="form"
            aria-label="Office sign in"
            onSubmit={handleSubmit}
            noValidate
            aria-busy={submitting}
          >
            <div className="field">
              <label className="field__label" htmlFor={emailId}>
                Site email
              </label>
              <input
                id={emailId}
                ref={emailRef}
                className="field__control"
                type="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck="false"
                required
                value={email}
                aria-invalid={error && !email.trim() ? 'true' : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (error) setError('');
                }}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor={passwordId}>
                Site password
              </label>
              <input
                id={passwordId}
                ref={passwordRef}
                className="field__control"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                aria-invalid={error && !password ? 'true' : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) setError('');
                }}
              />
            </div>

            <div aria-live="polite">
              {error && (
                <p className="form-error" id={errorId}>
                  <Icon name="error" />
                  {error}
                </p>
              )}
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                <Icon name="login" />
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>

          <p className="note">
            <Icon name="info" />
            <span>
              Lost or compromised credentials? Ask the central admin to issue a
              new set. The office keeps its logged items either way.
            </span>
          </p>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
