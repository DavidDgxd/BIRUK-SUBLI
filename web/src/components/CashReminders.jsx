import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { formatPeso, listCashReminders } from '../lib/cashReminders.js';

function formatDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function statusLabel(reminder) {
  if (reminder.reminder_type === 'due') {
    return reminder.days_until_reward === 0
      ? 'Due today'
      : `Due since ${formatDate(reminder.reward_date)}`;
  }
  const days = reminder.days_until_reward;
  return days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
}

/*
 * Six-month cash reminders for the signed-in office (US-28).
 *
 * Lists held cash whose reward date has arrived ('due') or is 14 days away or
 * less ('approaching'), with the finder's name and contact so the counter can
 * reach them. The view does the scoping and the campus date; this panel only
 * renders it. On-screen only: no email or SMS.
 */
export default function CashReminders({ reloadKey = 0 }) {
  const headingId = useId();
  const [reminders, setReminders] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setReminders(null);
    setLoadError(false);

    listCashReminders({ signal: controller.signal })
      .then((rows) => {
        if (active) setReminders(rows);
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        if (import.meta.env.DEV) console.error('[CashReminders]', error);
        setReminders([]);
        setLoadError(true);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey, attempt]);

  const due = reminders?.filter((r) => r.reminder_type === 'due') ?? [];
  const approaching =
    reminders?.filter((r) => r.reminder_type === 'approaching') ?? [];

  return (
    <section className="cash-reminders" aria-labelledby={headingId}>
      <h2 id={headingId} className="cash-reminders__title">
        <Icon name="schedule" />
        Cash reminders
      </h2>
      <p className="cash-reminders__lead">
        Cash held for six months goes to the finder. Items appear here 14 days
        before their reward date and stay until they leave your custody.
      </p>

      {reminders === null && (
        <p className="loading" role="status">
          <Icon name="hourglass_top" className="icon--pulse" />
          Loading cash reminders…
        </p>
      )}

      {loadError && (
        <div className="cash-reminders__error" role="alert">
          <p>We could not load cash reminders right now.</p>
          <button
            type="button"
            className="btn"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <Icon name="refresh" />
            Try again
          </button>
        </div>
      )}

      {reminders !== null && !loadError && reminders.length === 0 && (
        <p className="cash-reminders__empty" role="status">
          No cash is due for the finder in the next 14 days.
        </p>
      )}

      {[
        ['due', 'Due now', due],
        ['approaching', 'Approaching', approaching],
      ].map(
        ([type, label, rows]) =>
          rows.length > 0 && (
            <div key={type} className="cash-reminders__group">
              <h3 className="cash-reminders__group-title">
                {label} ({rows.length})
              </h3>
              <ul className="cash-reminders__list">
                {rows.map((reminder) => (
                  <li
                    key={reminder.id}
                    className={`cash-reminder cash-reminder--${type}`}
                  >
                    <div className="cash-reminder__head">
                      <Link
                        className="cash-reminder__link"
                        to={`/items/${reminder.id}`}
                      >
                        {reminder.title}
                      </Link>
                      <span className="cash-reminder__status">
                        {statusLabel(reminder)}
                      </span>
                    </div>
                    <dl className="cash-reminder__facts">
                      <div>
                        <dt>Reference</dt>
                        <dd className="cash-reminder__ref">
                          {reminder.ref_code}
                        </dd>
                      </div>
                      <div>
                        <dt>Reward date</dt>
                        <dd>{formatDate(reminder.reward_date)}</dd>
                      </div>
                      {formatPeso(reminder.cash_amount) && (
                        <div>
                          <dt>Amount</dt>
                          <dd>{formatPeso(reminder.cash_amount)}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Finder</dt>
                        <dd>{reminder.finder_name}</dd>
                      </div>
                      <div>
                        <dt>Finder contact</dt>
                        <dd>{reminder.finder_contact}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
    </section>
  );
}
