import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { calibrateMatchScore } from '../lib/searchItems.js';

/** Intake date as "8 Oct 2026", or null when the value is missing or unparseable. */
function formatLoggedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/*
 * Item detail view (US-18): what a searcher opens from a result to decide
 * whether the item is theirs before travelling to the counter.
 *
 * It shows the photo, the classification, and the office holding the item, and
 * says what the desk will ask for. It deliberately does NOT show
 * items.description: that column is the staff verification record (marks,
 * serial numbers, condition) and was hidden from the public in 8bb92fd so it
 * could not be read here and recited at the counter. The photo is the
 * claimant's evidence; the desk check remains the proof.
 *
 * No claim action either (US-19) — release happens in person, at the counter.
 */
export default function ItemDetailDialog({ open, item, onClose }) {
  const dialogRef = useRef(null);
  const [imageFailed, setImageFailed] = useState(false);

  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // A photo that failed for one item must not leave the next item's dialog
  // showing a broken image.
  useEffect(() => {
    setImageFailed(false);
  }, [item]);

  function handleBackdropClick(event) {
    // Clicks inside land on the body or its children, never on the dialog box
    // itself, so this only fires for the backdrop.
    if (event.target === dialogRef.current) onClose();
  }

  const showImage = Boolean(item?.image_url) && !imageFailed;
  const logged = formatLoggedDate(item?.created_at);
  const match = item ? calibrateMatchScore(item.similarity) : null;

  return (
    <dialog
      ref={dialogRef}
      className="item-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={handleBackdropClick}
    >
      {item && (
        <div className="item-dialog__body">
          <div className="item-dialog__media">
            {showImage ? (
              <img
                src={item.image_url}
                alt={`Photo of ${item.title}`}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div
                className="item-dialog__no-photo"
                role="img"
                aria-label="No photo available"
              >
                <Icon name="hide_image" />
              </div>
            )}
          </div>

          <div className="item-dialog__content">
            <header className="item-dialog__head">
              <h2 className="item-dialog__title" id={titleId}>
                {item.title}
              </h2>
              <button
                type="button"
                className="icon-btn"
                onClick={onClose}
                aria-label="Close item details"
              >
                <Icon name="close" />
              </button>
            </header>

            <p className="item-dialog__meta">
              <span
                className={`item-dialog__badge item-dialog__badge--${match.tier}`}
              >
                {match.percent}% Match
              </span>
              <span className="item-dialog__ref">Ref {item.ref_code}</span>
              {logged && (
                <span className="item-dialog__ref">Logged {logged}</span>
              )}
            </p>

            <p className="item-dialog__category">
              <Icon name="category" />
              {item.category}
            </p>

            <p className="item-dialog__verify">
              <Icon name="verified_user" />
              <span>
                Bring a valid ID to the counter and be ready to describe unique
                marks, serial numbers, or condition. The office checks that
                against its own record before releasing the item.
              </span>
            </p>

            <div className="item-dialog__office">
              <p className="item-dialog__office-name">
                <Icon name="location_on" />
                <span>
                  <span className="visually-hidden">Held at </span>
                  {item.holding_office_name}
                </span>
              </p>
              <p className="item-dialog__office-line">
                <Icon name="map" />
                <span>{item.office_address}</span>
              </p>
              <p className="item-dialog__office-line">
                <Icon name="schedule" />
                <span>{item.counter_hours}</span>
              </p>
            </div>

            <div className="item-dialog__actions">
              <button
                type="button"
                className="btn btn--filled"
                onClick={onClose}
              >
                <Icon name="check" />
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
