import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { supabase } from '../lib/supabase.js';
import {
  loadStaffSession,
  signInWithSiteCredentials,
  signOutOfSite,
} from '../lib/staffAuth.js';

/*
 * Staff session context for the counter pages.
 *
 * Office staff sign in with their office's shared credentials (US-02): a single
 * Supabase Auth user per office, minted by the central admin in US-01 and tied
 * to the office row through `offices.auth_user_id`. This provider owns that
 * session and resolves it to the office the counter is filing against, so pages
 * only ever read useStaffAuth() and never touch the client themselves.
 *
 * A build can skip the login and act as the default office by setting
 * VITE_STAFF_DEV_SESSION=true. That flag is the only way the mock session is
 * handed out — it is never enabled on its own — and it is labelled "Dev session
 * · not real auth" wherever the signed-in office is shown.
 */

const DEV_STAFF_SESSION = import.meta.env.VITE_STAFF_DEV_SESSION === 'true';
const DEV_OFFICE_ID = import.meta.env.VITE_STAFF_OFFICE_ID || 'BCPIO';
const DEV_OFFICE_NAME =
  import.meta.env.VITE_STAFF_OFFICE_NAME ||
  'Baguio City Public Information Office';
const DEV_STAFF_EMAIL = 'staff@baguio.gov.ph';

const StaffAuthContext = createContext(null);

function mockSession() {
  return {
    staffEmail: DEV_STAFF_EMAIL,
    officeId: DEV_OFFICE_ID,
    officeName: DEV_OFFICE_NAME,
    isMock: true,
  };
}

export function StaffAuthProvider({ children }) {
  const [session, setSession] = useState(() =>
    DEV_STAFF_SESSION ? mockSession() : null,
  );
  const [status, setStatus] = useState(() =>
    DEV_STAFF_SESSION ? 'authenticated' : 'loading',
  );

  // Follow the Supabase session rather than reading it once. onAuthStateChange
  // reports the stored login as soon as we subscribe (INITIAL_SESSION), then
  // every sign-in, sign-out and token refresh after that — including ones made
  // from another tab.
  useEffect(() => {
    if (DEV_STAFF_SESSION) return undefined;

    let active = true;
    // Auth user the office has already been resolved for. A token refresh
    // reports the same user, and re-running the lookup for it would query
    // `offices` every hour and let one failed request eject an officer
    // mid-shift.
    let resolvedFor = null;

    function applyAuthUser(user) {
      if (!user) {
        resolvedFor = null;
        setSession(null);
        setStatus('unauthenticated');
        return;
      }
      if (resolvedFor === user.id) return;
      resolvedFor = user.id;

      // The callback below must not await other Supabase calls, so the office
      // lookup runs off the event rather than inside it. `active` drops results
      // from a run that has already been torn down.
      loadStaffSession(user)
        .then((resolved) => {
          if (!active) return;
          if (!resolved) {
            resolvedFor = null;
            setSession(null);
            setStatus('unauthenticated');
            return;
          }
          setSession(resolved);
          setStatus('authenticated');
        })
        .catch(() => {
          if (!active) return;
          resolvedFor = null;
          setSession(null);
          setStatus('unauthenticated');
        });
    }

    const { data } = supabase.auth.onAuthStateChange((_event, authSession) => {
      applyAuthUser(authSession?.user ?? null);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      session,
      status,
      isAuthenticated: status === 'authenticated',
      office: session
        ? { id: session.officeId, name: session.officeName }
        : null,
      /** Signs in with the office's shared credentials; throws StaffAuthError. */
      async signIn(email, password) {
        const next = await signInWithSiteCredentials(email, password);
        setSession(next);
        setStatus('authenticated');
        return next;
      },
      /** Ends the shared session. Throws StaffAuthError if it could not. */
      async signOut() {
        await signOutOfSite();
        setSession(null);
        setStatus('unauthenticated');
      },
    }),
    [session, status],
  );

  return (
    <StaffAuthContext.Provider value={value}>
      {children}
    </StaffAuthContext.Provider>
  );
}

export function useStaffAuth() {
  const context = useContext(StaffAuthContext);
  if (!context) {
    throw new Error('useStaffAuth must be used within a StaffAuthProvider');
  }
  return context;
}
