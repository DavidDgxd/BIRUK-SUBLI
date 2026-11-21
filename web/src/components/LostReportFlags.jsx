import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useStaffAuth } from '../context/StaffAuthContext.jsx';
import {
  dismissLostReportMatch,
  fetchLostReportMatches,
} from '../lib/lostReportMatches.js';

const MATCH_ERROR_COPY =
  'We could not check the lost-item reports for this item. The custody record is saved.';
const DISMISS_ERROR_COPY =
  'We could not dismiss this flag. It is still listed; try again.';

function formatLostDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/*
 * Possible lost-item matches on the custody receipt (US-16).
 *
 * Mounts after a successful submit and checks the new item against open lost
 * reports. The check is advisory: nothing is sent to the reporter, the item is
 * not reserved, and a failed check never touches the item or the receipt.
 * Retry re-runs matching for the same item id and never resubmits custody.
 *
 * Rows hold lost-report contact detail, which is staff-visible PII. It stays in
 * memory for the life of the receipt: no storage writes, and the failure copy
 * carries no row data. The dev-mock session runs on the anon key, where the
 * match RPC is refused, so it gets an explicit unavailable state and makes no
 * call.
 */
export default function LostReportFlags({ itemId }) {
  const { session } = useStaffAuth();
  const isMock = session?.isMock === true;
  const headingId = useId();
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState(() =>
    isMock || !itemId ? 'unavailable' : 'loading',
  );
  const [matches, setMatches] = useState([]);
  const [pending, setPending] = useState({});
  const [dismissErrors, setDismissErrors] = useState({});
  const [announcement, setAnnouncement] = useState('');
  const pendingRef = useRef(new Set());

  useEffect(() => {
    if (isMock) {
      setPhase('unavailable');
      setMatches([]);
      setAnnouncement(
        'Lost-item matching is unavailable in the development session.',
      );
      return undefined;
    }
    if (!itemId) {
      setPhase('unavailable');
      setMatches([]);
      setAnnouncement('Lost-item matching is unavailable for this receipt.');
      return undefined;
    }

    let active = true;
    const controller = new AbortController();
    setPhase('loading');
    setMatches([]);
    setDismissErrors({});
    setAnnouncement('Checking lost-item reports for possible matches.');

    fetchLostReportMatches(itemId, { signal: controller.signal })
      .then((rows) => {
        if (!active) return;
        setMatches(rows);
        setPhase('ready');
        setAnnouncement(
          rows.length === 0
            ? 'No close lost-item reports found.'
            : `${rows.length} possible lost-item report${
                rows.length === 1 ? '' : 's'
              } found.`,
        );
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        if (import.meta.env.DEV) console.error('[LostReportFlags]', error);
        setMatches([]);
        setPhase('error');
        setAnnouncement(MATCH_ERROR_COPY);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, isMock, itemId]);

  async function handleDismiss(match) {
    // A ref, not the state map, is the guard: two clicks in one frame both see
    // the pre-click state, but only the first gets past this check.
    if (pendingRef.current.has(match.lostReportId)) return;
    pendingRef.current.add(match.lostReportId);

    const { lostReportId } = match;
    setPending((current) => ({ ...current, [lostReportId]: true }));
    setDismissErrors((current) => ({ ...current, [lostReportId]: '' }));

    try {
      await dismissLostReportMatch(itemId, lostReportId);
      setMatches((current) =>
        current.filter((row) => row.lostReportId !== lostReportId),
      );
      setAnnouncement('Flag dismissed.');
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[LostReportFlags] dismiss', error);
      }
      setDismissErrors((current) => ({
        ...current,
        [lostReportId]: DISMISS_ERROR_COPY,
      }));
      setAnnouncement(DISMISS_ERROR_COPY);
    } finally {
      pendingRef.current.delete(lostReportId);
      setPending((current) => {
        const next = { ...current };
        delete next[lostReportId];
        return next;
      });
    }
  }

  return (
    <section
      className="caption-suggestion lost-report-flags"
      aria-labelledby={headingId}
    >
      <h3 className="caption-suggestion__label" id={headingId}>
        <Icon name="report_lost" />
        Possible lost-item matches
      </h3>
      <p className="field__hint">
        Advisory check only: nothing has been sent to the person who reported a
        loss. The item is not reserved and stays claimable through the normal
        process.
      </p>

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      {phase === 'loading' && (
        <p className="loading">
          <Icon name="hourglass_top" className="icon--pulse" />
          Checking lost-item reports…
        </p>
      )}

      {phase === 'unavailable' && (
        <p className="field__hint">
          {isMock
            ? 'Lost-item matching is unavailable in this development session. Sign in with an office login to check the reports.'
            : 'Lost-item matching is unavailable for this receipt.'}
        </p>
      )}

      {phase === 'error' && (
        <>
          <p className="field__hint">
            {MATCH_ERROR_COPY} Try again to re-check; the item is already
            logged.
          </p>
          <div className="state__actions">
            <button
              type="button"
              className="btn"
              onClick={() => setAttempt((count) => count + 1)}
            >
              <Icon name="refresh" />
              Try again
            </button>
          </div>
        </>
      )}

      {phase === 'ready' && matches.length === 0 && (
        <p className="field__hint">
          No close lost-item reports were found for this item.
        </p>
      )}

      {phase === 'ready' && matches.length > 0 && (
        <ul className="staff-items__list">
          {matches.map((match) => {
            const dismissing = Boolean(pending[match.lostReportId]);
            const dismissError = dismissErrors[match.lostReportId];
            const lostDate = formatLostDate(match.dateLost);

            return (
              <li key={match.lostReportId} className="staff-item">
                <div className="staff-item__body">
                  <p className="staff-item__title">{match.description}</p>
                  <p className="staff-item__meta">
                    <span className="staff-item__ref">{match.refCode}</span>
                    {lostDate && <span>Lost {lostDate}</span>}
                    <span>{match.areaRoute}</span>
                    <span>
                      {match.contactInfo
                        ? `Contact: ${match.contactInfo}`
                        : 'No contact provided'}
                    </span>
                    <span>{Math.round(match.similarity * 100)}% match</span>
                  </p>
                  {dismissError && <p className="form-error">{dismissError}</p>}
                </div>
                <button
                  type="button"
                  className="btn btn--quiet"
                  disabled={dismissing}
                  onClick={() => handleDismiss(match)}
                >
                  <Icon name={dismissing ? 'hourglass_top' : 'close'} />
                  {dismissing ? 'Dismissing…' : 'Dismiss'}
                  <span className="visually-hidden">
                    {' '}
                    the flag for {match.refCode}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
