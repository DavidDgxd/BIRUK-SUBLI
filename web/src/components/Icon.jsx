/*
 * One inline SVG icon set. Icons are decorative by default: every control that
 * uses one also carries a text label or an aria-label, so the svg is hidden
 * from assistive technology with aria-hidden and focusable="false".
 */

const PATHS = {
  add: <path d="M12 5v14M5 12h14" />,
  add_box: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="1.5" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  apartment: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" />
    </>
  ),
  arrow_back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  arrow_forward: <path d="M5 12h14M12 5l7 7-7 7" />,
  arrow_right_sharp: <path d="M5 12h14M13 6l6 6-6 6" />,
  assignment_turned_in: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="1.5" />
      <path d="M9 4V3h6v1" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  badge: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M7 16c0-1.5 1-2 2-2s2 .5 2 2M14 10h4M14 13h4" />
    </>
  ),
  category: (
    <>
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  check_circle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-5" />
    </>
  ),
  chevron_right: <path d="m9 6 6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  corporate_fare: (
    <>
      <rect x="4" y="3" width="10" height="18" rx="1" />
      <path d="M14 9h6v12h-6M8 7h2M8 11h2M8 15h2M17 13h1M17 17h1" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="5" rx="1" />
      <rect x="13" y="10" width="8" height="11" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
    </>
  ),
  description: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5M9 12h6M9 16h6" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 17h.01" />
    </>
  ),
  hide_image: (
    <>
      <path d="M3 3l18 18" />
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 16 5-5 3 3 2-2 6 6" />
      <circle cx="15" cy="9" r="1" />
    </>
  ),
  hourglass_top: <path d="M7 3h10M7 21h10M8 3v4l4 4 4-4V3M8 21v-4l4-4 4 4v4" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  inventory_2: (
    <>
      <path d="M4 8h16v12H4z" />
      <path d="M3 4h18v4H3z" />
      <path d="M9 12h6" />
    </>
  ),
  ledger_crest: (
    <>
      <path d="M5 3h9l4 4v14H5z" />
      <path d="M14 3v5h5" />
      <path d="m12 9 2.75 4h-5.5z" />
      <path d="M12 12v5M9.5 17h5" />
    </>
  ),
  lightbulb: (
    <path d="M9 18h6M10 21h4M8 14a6 6 0 1 1 8 0c-.8.7-1 1.5-1 2H9c0-.5-.2-1.3-1-2z" />
  ),
  location_on: (
    <>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="1.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  lock_reset: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="1.5" />
      <path d="M8 10V7a4 4 0 0 1 7-2.5M15 3v3h-3" />
    </>
  ),
  login: (
    <>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="m10 17 5-5-5-5M15 12H3" />
    </>
  ),
  logout: (
    <>
      <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </>
  ),
  map: (
    <>
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
      <path d="M9 3v15M15 6v15" />
    </>
  ),
  more_horiz: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H13a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4 6 6 0 0 0-6-6z" />
      <circle cx="8" cy="9" r="1" />
      <circle cx="8" cy="14" r="1" />
      <circle cx="12" cy="7" r="1" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  photo_camera: (
    <>
      <path d="M4 7h3l2-2h6l2 2h3v12H4z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  print: (
    <>
      <path d="M6 9V3h12v6" />
      <rect x="4" y="9" width="16" height="8" rx="1.5" />
      <path d="M8 17h8v4H8z" />
    </>
  ),
  priority_high: <path d="M12 4v10M12 19h.01" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2 6" />
      <path d="M20 4v7h-7" />
    </>
  ),
  report_found: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  report_lost: (
    <>
      <path d="M6 3h8l4 4v9" />
      <path d="M14 3v5h5" />
      <path d="M9 11h6M9 15h2" />
      <circle cx="16.5" cy="17.5" r="3.5" />
      <path d="M16.5 16v2M16.5 19.5h.01" />
    </>
  ),
  schedule: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  send: (
    <>
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4z" />
    </>
  ),
  step_counter: (
    <>
      <path d="M3 20h18M5 20V9l7-4 7 4v11" />
      <path d="M8 12h2M14 12h2M9 16h6" />
    </>
  ),
  step_query: (
    <>
      <path d="M4 5h16v14H4z" />
      <circle cx="10.5" cy="11" r="3" />
      <path d="m12.7 13.2 2.8 2.8M17.5 8h.01" />
    </>
  ),
  step_seal: (
    <>
      <circle cx="12" cy="10" r="5" />
      <path d="m9.5 10 1.7 1.7 3.3-3.7" />
      <path d="m8.5 14.4-1 6.1 4.5-2 4.5 2-1-6.1" />
    </>
  ),
  swap_horiz: <path d="M4 7h16M17 4l3 3-3 3M20 17H4M7 14l-3 3 3 3" />,
  tune: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </>
  ),
  verified_user: (
    <>
      <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  visibility: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  visibility_off: (
    <>
      <path d="M10.6 6.2A10.6 10.6 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.8" />
      <path d="M6.6 6.6C3.7 8.4 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.3-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 9v5M12 17h.01" />
    </>
  ),
};

export default function Icon({ name, className = '', size = 24, strokeWidth }) {
  return (
    <svg
      className={`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] ?? PATHS.info}
    </svg>
  );
}
