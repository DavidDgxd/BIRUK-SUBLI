import { createContext, useContext, useMemo, useState } from 'react';

/*
 * Staff session context for the counter pages.
 *
 * Real Supabase Auth and staff provisioning do not exist yet, so a development
 * build hands every visitor a mock counter-staff session for the default office.
 * Pages only ever read the session through useStaffAuth(); when real auth lands
 * the internals here change (fetch the Supabase session, resolve the office via
 * offices.auth_user_id) and no consuming page is touched.
 *
 * The mock office id comes from VITE_STAFF_OFFICE_ID and defaults to 'BCPIO',
 * the Baguio City Public Information Office row seeded in `offices`.
 *
 * Production builds (import.meta.env.PROD) stay signed out until real auth
 * exists — that is deliberate, so a deployed bundle never exposes the counter.
 * A preview build can opt back into the mock with VITE_STAFF_DEV_SESSION=true.
 */

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

/**
 * Real-auth seam. Returns a session in the same shape as mockSession(), or null.
 *
 * TODO(auth): read supabase.auth.getSession(), then look up the staff member's
 * office by offices.auth_user_id once an admin provisioning UI exists.
 */
async function loadRealSession() {
  return null;
}

export function StaffAuthProvider({ children }) {
  const [session] = useState(() => {
    const useMock =
      import.meta.env.DEV || import.meta.env.VITE_STAFF_DEV_SESSION === 'true';
    // loadRealSession() is async, so a production build starts signed out and
    // would sign in through signIn() once that is implemented.
    return useMock ? mockSession() : null;
  });

  const value = useMemo(
    () => ({
      session,
      status: session ? 'authenticated' : 'unauthenticated',
      isAuthenticated: Boolean(session),
      office: session
        ? { id: session.officeId, name: session.officeName }
        : null,
      /** TODO(auth): supabase.auth.signInWithPassword(...) then loadRealSession(). */
      async signIn() {
        throw new Error('Staff sign-in is not implemented yet.');
      },
      /** TODO(auth): supabase.auth.signOut() and clear the session. */
      async signOut() {
        throw new Error('Staff sign-out is not implemented yet.');
      },
    }),
    [session],
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

export { loadRealSession };
