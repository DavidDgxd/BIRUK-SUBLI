import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { submitStaffCustody } from '../lib/staffIntake.js';
import { ACCEPTED_IMAGE_TYPES, MAX_SOURCE_BYTES } from '../lib/storage.js';

const ACCEPTED_TYPES = ACCEPTED_IMAGE_TYPES;
const MAX_PHOTO_BYTES = MAX_SOURCE_BYTES;
const MAX_TITLE_LENGTH = 120;
const MAX_SHORT_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 1000;

/*
 * 'Cash' is special: it is the one category with a statutory retention rule
 * (a 6-month reward clock, see calculate_cash_reward_date), so the form asks
 * for the amount and the finder when it is chosen. Every other value is stored
 * as free-text classification.
 */
const CATEGORIES = [
  'General',
  'Electronics',
  'Bags & Wallets',
  'Documents / IDs',
  'Keys',
  'Personal Accessories',
  'Clothing',
  'Cash',
  'Other',
];

const ERROR_COPY = {
  'ai-unreachable':
    'We could not reach the matching service. Please try again in a moment.',
  'ai-failed': 'The matching service ran into a problem. Please try again.',
  'ai-bad-response':
    'The matching service sent something unexpected. Please try again.',
  'image-convert':
    'We could not process that photo. Please try a different one.',
  'image-upload': 'We could not upload the photo. Please try again.',
  db: 'We could not file the custody record right now. Please try again.',
};

/** Local calendar date as YYYY-MM-DD, so the max is today in the staffer's timezone. */
function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

/** Values are staff-entered, so they must be escaped before going into the print document. */
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

/*
 * Staff custody intake form.
 *
 * The counter officer logs an item handed in over the desk. Everything is
 * required except the optional half of the cash block, because the record is
 * what makes the item findable and traceable later. On success the ref_code the
 * database generated is shown as the custody receipt, with copy and print.
 */
export default function StaffIntakeForm({ office, staffEmail }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [description, setDescription] = useState('');
  const [dateReceived, setDateReceived] = useState(todayIso);
  const [cashAmount, setCashAmount] = useState('');
  const [finderName, setFinderName] = useState('');
  const [finderContact, setFinderContact] = useState('');
  const [photo, setPhoto] = useState(null); // { file, url }
  const [error, setError] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'done'
  const [receipt, setReceipt] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copyNote, setCopyNote] = useState('');

  const titleRef = useRef(null);
  const categoryRef = useRef(null);
  const storageRef = useRef(null);
  const descriptionRef = useRef(null);
  const dateRef = useRef(null);
  const cashRef = useRef(null);
  const finderRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadButtonRef = useRef(null);
  const receiptRef = useRef(null);
  const refCodeRef = useRef(null);
  const controllerRef = useRef(null);

  const titleId = useId();
  const titleHintId = useId();
  const categoryId = useId();
  const storageId = useId();
  const storageHintId = useId();
  const descriptionId = useId();
  const descriptionHintId = useId();
  const dateId = useId();
  const cashId = useId();
  const cashHintId = useId();
  const finderId = useId();
  const finderHintId = useId();
  const finderContactId = useId();
  const photoId = useId();
  const errorId = useId();

  const isCash = category === 'Cash';

  // Release the preview URL when the photo is replaced, removed or unmounted.
  useEffect(() => {
    if (!photo) return undefined;
    return () => URL.revokeObjectURL(photo.url);
  }, [photo]);

  // Abandon an in-flight submission if the page goes away.
  useEffect(() => () => controllerRef.current?.abort(), []);

  // Move focus to the receipt so screen readers announce the reference code.
  useEffect(() => {
    if (status === 'done') receiptRef.current?.focus();
  }, [status]);

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please choose a JPG, PNG or WebP photo.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError('That photo is larger than 8 MB. Please choose a smaller one.');
      return;
    }
    setError('');
    setPhoto({ file, url: URL.createObjectURL(file) });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (status === 'submitting') return;

    const trimmedTitle = title.trim();
    const trimmedStorage = storageLocation.trim();
    const trimmedDescription = description.trim();

    if (!trimmedTitle) {
      setError('Give the item a short title.');
      titleRef.current?.focus();
      return;
    }
    if (!category) {
      setError('Choose a category.');
      categoryRef.current?.focus();
      return;
    }
    if (!trimmedStorage) {
      setError('Record where the item is physically stored.');
      storageRef.current?.focus();
      return;
    }
    if (!trimmedDescription) {
      setError('Add verification notes for the item.');
      descriptionRef.current?.focus();
      return;
    }
    if (!dateReceived) {
      setError('Choose the date the item was received.');
      dateRef.current?.focus();
      return;
    }
    if (dateReceived > todayIso()) {
      setError('The date received cannot be in the future.');
      dateRef.current?.focus();
      return;
    }
    if (isCash && !finderName.trim()) {
      setError('Record the finder’s name so the cash reward can be claimed.');
      finderRef.current?.focus();
      return;
    }
    if (!photo) {
      setError('Add a photo of the item.');
      uploadButtonRef.current?.focus();
      return;
    }

    setError('');
    setStatus('submitting');

    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await submitStaffCustody({
        officeId: office.id,
        title: trimmedTitle,
        description: trimmedDescription,
        category,
        storageLocation: trimmedStorage,
        dateReceived,
        cashAmount,
        finderName,
        finderContact,
        photo: photo.file,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setReceipt({
        ...result,
        title: trimmedTitle,
        category,
        storageLocation: trimmedStorage,
        dateReceived,
        officeName: office.name,
        staffEmail,
      });
      setStatus('done');
    } catch (submitError) {
      if (controller.signal.aborted || submitError.name === 'AbortError')
        return;
      if (import.meta.env.DEV) console.error('[StaffIntakeForm]', submitError);
      setStatus('idle');
      const known = ERROR_COPY[submitError.code];
      setError(
        known ??
          (import.meta.env.DEV && submitError.message
            ? submitError.message
            : ERROR_COPY.db),
      );
    } finally {
      controllerRef.current = null;
    }
  }

  function startAnother() {
    setTitle('');
    setCategory('');
    setStorageLocation('');
    setDescription('');
    setDateReceived(todayIso());
    setCashAmount('');
    setFinderName('');
    setFinderContact('');
    setPhoto(null);
    setReceipt(null);
    setError('');
    setCopied(false);
    setCopyNote('');
    setStatus('idle');
  }

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(receipt.refCode);
      setCopied(true);
      setCopyNote('');
    } catch {
      // Clipboard access is unavailable (older browsers, non-secure origin);
      // select the code so the staffer can copy it by hand.
      const node = refCodeRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopyNote('Copy failed — the code is selected, press Ctrl/Cmd+C.');
    }
  }

  function printReceipt(current) {
    const win = window.open('', 'custody-receipt', 'width=420,height=640');
    if (!win) {
      window.print();
      return;
    }

    const rows = [
      ['Item', current.title],
      ['Category', current.category],
      ['Stored at', current.storageLocation],
      ['Received', current.dateReceived],
      ['Office', current.officeName],
      ['Logged by', current.staffEmail],
    ]
      .map(
        ([label, value]) =>
          `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
      )
      .join('');

    win.document.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Custody receipt ${escapeHtml(current.refCode)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 32px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .office { margin: 0 0 16px; color: #444; font-size: 13px; }
  .ref { font-family: ui-monospace, monospace; font-size: 22px; font-weight: 700;
         letter-spacing: 0.08em; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 6px 0; vertical-align: top;
           border-bottom: 1px solid #ddd; }
  th { width: 38%; color: #555; font-weight: 600; }
  .note { margin-top: 24px; font-size: 12px; color: #666; }
</style>
</head>
<body>
  <h1>Custody receipt</h1>
  <p class="office">${escapeHtml(current.officeName)}</p>
  <p class="ref">${escapeHtml(current.refCode)}</p>
  <table>${rows}</table>
  <p class="note">Keep this slip. Quote the reference above when claiming the item at the counter.</p>
</body>
</html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  if (status === 'done' && receipt) {
    return (
      <section className="state-card state-card--success" role="status">
        <h3 className="state-card__title" tabIndex={-1} ref={receiptRef}>
          Item taken into custody
        </h3>
        <p className="state-card__text">
          The item is logged to {receipt.officeName} and is now searchable. Give
          the reference below to whoever handed it in.
        </p>
        <p
          className="receipt"
          ref={refCodeRef}
          aria-label={`Custody reference ${receipt.refCode}`}
        >
          {receipt.refCode}
        </p>
        <dl className="receipt-details">
          <div className="receipt-details__row">
            <dt>Item</dt>
            <dd>{receipt.title}</dd>
          </div>
          <div className="receipt-details__row">
            <dt>Category</dt>
            <dd>{receipt.category}</dd>
          </div>
          <div className="receipt-details__row">
            <dt>Stored at</dt>
            <dd>{receipt.storageLocation}</dd>
          </div>
          <div className="receipt-details__row">
            <dt>Received</dt>
            <dd>{receipt.dateReceived}</dd>
          </div>
          <div className="receipt-details__row">
            <dt>Logged by</dt>
            <dd>{receipt.staffEmail}</dd>
          </div>
        </dl>
        {!receipt.usedPhoto && (
          <p className="state-card__text">
            The photo was saved, but we could not read it for matching — this
            item is searchable by its text details alone.
          </p>
        )}
        {copyNote && <p className="state-card__text">{copyNote}</p>}
        <div className="state-card__actions">
          <button
            type="button"
            className="btn btn--filled"
            onClick={copyReference}
          >
            <Icon name={copied ? 'check' : 'content_copy'} />
            {copied ? 'Copied' : 'Copy reference'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => printReceipt(receipt)}
          >
            <Icon name="print" />
            Print receipt
          </button>
          <Link className="btn" to="/search">
            <Icon name="search" />
            Search held items
          </Link>
          <button type="button" className="btn" onClick={startAnother}>
            <Icon name="add" />
            Log another item
          </button>
        </div>
      </section>
    );
  }

  const submitting = status === 'submitting';

  return (
    <form
      className="report-form"
      onSubmit={handleSubmit}
      noValidate
      aria-busy={submitting}
    >
      <div className="field">
        <label className="field__label" htmlFor={titleId}>
          Item title
        </label>
        <input
          id={titleId}
          ref={titleRef}
          className="field__control"
          type="text"
          maxLength={MAX_TITLE_LENGTH}
          placeholder="Black leather wallet"
          value={title}
          aria-describedby={error ? `${titleHintId} ${errorId}` : titleHintId}
          aria-invalid={error && !title.trim() ? 'true' : undefined}
          onChange={(event) => {
            setTitle(event.target.value);
            if (error) setError('');
          }}
        />
        <p className="field__hint" id={titleHintId}>
          Shown in public search results, so keep it generic (colour and type).
          Put serial numbers and unique marks in the private notes below.
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={categoryId}>
          Category
        </label>
        <select
          id={categoryId}
          ref={categoryRef}
          className="field__control field__control--select"
          value={category}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error && !category ? 'true' : undefined}
          onChange={(event) => {
            setCategory(event.target.value);
            if (error) setError('');
          }}
        >
          <option value="" disabled>
            Choose a category…
          </option>
          {CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={storageId}>
          Storage location
        </label>
        <input
          id={storageId}
          ref={storageRef}
          className="field__control"
          type="text"
          maxLength={MAX_SHORT_LENGTH}
          placeholder="Locker 2, Bin B"
          value={storageLocation}
          aria-describedby={
            error ? `${storageHintId} ${errorId}` : storageHintId
          }
          aria-invalid={error && !storageLocation.trim() ? 'true' : undefined}
          onChange={(event) => {
            setStorageLocation(event.target.value);
            if (error) setError('');
          }}
        />
        <p className="field__hint" id={storageHintId}>
          The exact shelf, locker or bin where you placed it. Staff-only — never
          shown in the public search.
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={descriptionId}>
          Private verification notes
        </label>
        <textarea
          id={descriptionId}
          ref={descriptionRef}
          className="field__control field__control--area"
          rows={4}
          maxLength={MAX_DESCRIPTION_LENGTH}
          placeholder="Well-worn bifold wallet, slight tear on the inner lining. Serial 67 Written on the inner flap. Contains a bus card."
          value={description}
          aria-describedby={
            error ? `${descriptionHintId} ${errorId}` : descriptionHintId
          }
          aria-invalid={error && !description.trim() ? 'true' : undefined}
          onChange={(event) => {
            setDescription(event.target.value);
            if (error) setError('');
          }}
        />
        <p className="field__hint" id={descriptionHintId}>
          Staff-only — never shown in public search. Record serial numbers,
          unique marks, contents and condition here; this is what the desk uses
          to verify a claim, so be specific.
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={dateId}>
          Date received
        </label>
        <input
          id={dateId}
          ref={dateRef}
          className="field__control"
          type="date"
          max={todayIso()}
          value={dateReceived}
          aria-invalid={error && !dateReceived ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setDateReceived(event.target.value);
            if (error) setError('');
          }}
        />
      </div>

      {isCash && (
        <>
          <div className="field">
            <label className="field__label" htmlFor={cashId}>
              Cash amount <span className="field__optional">Optional</span>
            </label>
            <input
              id={cashId}
              ref={cashRef}
              className="field__control"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={cashAmount}
              aria-describedby={cashHintId}
              onChange={(event) => setCashAmount(event.target.value)}
            />
            <p className="field__hint" id={cashHintId}>
              Kept off the public listing. Cash is held for six months before
              the finder may claim the reward.
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor={finderId}>
              Finder&rsquo;s name
            </label>
            <input
              id={finderId}
              ref={finderRef}
              className="field__control"
              type="text"
              maxLength={MAX_SHORT_LENGTH}
              placeholder="Juan dela Cruz"
              value={finderName}
              aria-describedby={
                error ? `${finderHintId} ${errorId}` : finderHintId
              }
              aria-invalid={
                error && isCash && !finderName.trim() ? 'true' : undefined
              }
              onChange={(event) => {
                setFinderName(event.target.value);
                if (error) setError('');
              }}
            />
            <p className="field__hint" id={finderHintId}>
              Required for cash — the finder needs this to claim the reward.
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor={finderContactId}>
              Finder&rsquo;s contact{' '}
              <span className="field__optional">Optional</span>
            </label>
            <input
              id={finderContactId}
              className="field__control"
              type="text"
              maxLength={MAX_SHORT_LENGTH}
              placeholder="Phone number or email"
              value={finderContact}
              onChange={(event) => setFinderContact(event.target.value)}
            />
          </div>
        </>
      )}

      <div className="field">
        <span className="field__label">Photo</span>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleFileChange}
        />
        <button
          type="button"
          ref={uploadButtonRef}
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          aria-describedby={photoId}
        >
          <Icon name="photo_camera" />
          <span className="btn__label">
            <span>{photo ? 'Change Photo' : 'Add Photo'}</span>
            <small>(JPG, PNG or WebP, up to 8 MB)</small>
          </span>
        </button>
        <p className="field__hint" id={photoId}>
          Required. The photo is uploaded and stored so the public can recognise
          the item, and so it contributes to matching. Avoid photographing
          people or personal details.
        </p>
        <p className="photo-tip">
          <Icon name="lightbulb" />
          <span>
            Tip: Photograph the item as a whole. Avoid photographing private
            identifiers like ID cards, serial number stickers, or passcode
            screens.
          </span>
        </p>
      </div>

      {photo && (
        <div className="photo-chip">
          <img
            className="photo-chip__img"
            src={photo.url}
            alt="Preview of the photo you selected"
          />
          <p className="photo-chip__name">
            {photo.file.name}
            <small>Stored with the custody record</small>
          </p>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setPhoto(null)}
            aria-label="Remove photo"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      <div aria-live="polite">
        {error && (
          <p className="search__error" id={errorId}>
            <Icon name="error" />
            {error}
          </p>
        )}
      </div>

      <div className="report-form__actions">
        <button type="submit" className="btn btn--filled" disabled={submitting}>
          <Icon name="login" />
          {submitting ? 'Filing the custody record…' : 'Take into Custody'}
        </button>
      </div>
    </form>
  );
}
