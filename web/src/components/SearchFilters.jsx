import { useEffect, useId, useState } from 'react';
import Icon from './Icon.jsx';

/*
 * Narrowing controls for the public search results (US-20).
 *
 * The applied values live in the URL (`office`, `from`, `to`) so a filtered
 * result page can be refreshed or shared. This form keeps a draft until the
 * user applies it, which lets them set both ends of the date range without
 * firing a search on every keystroke.
 */
export default function SearchFilters({
  offices,
  office,
  dateFrom,
  dateTo,
  onApply,
  onClear,
}) {
  const [draft, setDraft] = useState({ office, dateFrom, dateTo });
  const [error, setError] = useState('');

  const titleId = useId();
  const officeId = useId();
  const fromId = useId();
  const toId = useId();
  const hintId = useId();
  const errorId = useId();

  // The URL is the source of truth: a Clear, Back or shared link must reset the
  // draft to what is actually being applied.
  useEffect(() => {
    setDraft({ office, dateFrom, dateTo });
  }, [office, dateFrom, dateTo]);

  const hasApplied = Boolean(office || dateFrom || dateTo);
  const describedBy = error ? `${hintId} ${errorId}` : hintId;

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    if (error) setError('');
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) {
      setError('The start date must be on or before the end date.');
      return;
    }

    onApply(draft);
  }

  function handleClear() {
    setDraft({ office: '', dateFrom: '', dateTo: '' });
    setError('');
    onClear();
  }

  return (
    <section className="results-filters" aria-labelledby={titleId}>
      <h2 className="results-filters__title" id={titleId}>
        Filter results
      </h2>

      <form
        className="results-filters__form"
        aria-label="Filter search results"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="field">
          <label className="field__label" htmlFor={officeId}>
            Holding office
          </label>
          <select
            id={officeId}
            className="field__control field__control--select"
            value={draft.office}
            onChange={(event) => update('office', event.target.value)}
          >
            <option value="">All offices</option>
            {offices?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={fromId}>
            Received on or after
          </label>
          <input
            id={fromId}
            className="field__control"
            type="date"
            value={draft.dateFrom}
            max={draft.dateTo || undefined}
            onChange={(event) => update('dateFrom', event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={error ? 'true' : undefined}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={toId}>
            Received on or before
          </label>
          <input
            id={toId}
            className="field__control"
            type="date"
            value={draft.dateTo}
            min={draft.dateFrom || undefined}
            onChange={(event) => update('dateTo', event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={error ? 'true' : undefined}
          />
        </div>

        <div className="results-filters__actions">
          <button type="submit" className="btn btn--primary">
            <Icon name="tune" size={17} />
            Apply filters
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={handleClear}
            disabled={!hasApplied && !draft.office && !draft.dateFrom && !draft.dateTo}
          >
            <Icon name="close" size={17} />
            Clear filters
          </button>
        </div>
      </form>

      <p className="field__hint" id={hintId}>
        Dates refer to when the item was received at a counter.
      </p>

      <div aria-live="polite">
        {error && (
          <p className="form-error" id={errorId}>
            <Icon name="error" size={18} />
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
