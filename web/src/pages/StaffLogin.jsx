import { useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import MistHero from '../components/MistHero.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import Icon from '../components/Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';

/*
 * Office log in (US-02). Mounted at /staff/login.
 *
 * One set of credentials per office, issued by the central admin (US-01), so
 * whoever is on the counter that day can sign in without a personal account.
 * On success the officer lands on the intake screen; a session that arrives
 * while the form is open — a reload with the login still held — redirects the
 * same way.
 */
export default function StaffLogin() {
  const { isAuthenticated, signIn } = useStaffAuth();
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
  const from =
    typeof requested === 'string' && requested.startsWith('/')
      ? requested
      : '/staff/intake';

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
      <MistHero />
      <div className="page">
        <SiteHeader />
        <main className="report-page">
          <Link className="results__back" to="/">
            <Icon name="arrow_back" />
            Back to search
          </Link>

          <h2 className="results__title" tabIndex={-1} ref={headingRef}>
            Office log in
          </h2>
          <p className="report-page__lead">
            Counter staff sign in with the shared credentials issued to their
            office. One login covers the desk, so whoever is available that day
            can log items without a personal account.
          </p>

          <div className="staff-login">
            <form
              className="report-form staff-login__form"
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
                  <p className="search__error" id={errorId}>
                    <Icon name="error" />
                    {error}
                  </p>
                )}
              </div>

              <div className="report-form__actions">
                <button
                  type="submit"
                  className="btn btn--filled"
                  disabled={submitting}
                >
                  <Icon name="login" />
                  {submitting ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
            </form>

            <p className="staff-login__note">
              <Icon name="info" />
              Lost or compromised credentials? Ask the central admin to issue a
              new set — the office keeps its logged items either way.
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
