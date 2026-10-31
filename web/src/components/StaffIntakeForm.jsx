import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { captionImage } from '../lib/aiService.js';
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
  const [captionSuggestion, setCaptionSuggestion] = useState(null);
  const [captionAttempt, setCaptionAttempt] = useState(0);
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
  const captionControllerRef = useRef(null);
  const descriptionValueRef = useRef('');
  const autoFilledCaptionRef = useRef('');

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
  const suggestionApplied =
    captionSuggestion?.status === 'ready' &&
    description.trim() === captionSuggestion.text.trim();

  // Release the preview URL when the photo is replaced, removed or unmounted.
  useEffect(() => {
    if (!photo) return undefined;
    return () => URL.revokeObjectURL(photo.url);
  }, [photo]);

  // Keep the latest description available to the async caption handler, which
  // may finish after the staffer has started typing.
  useEffect(() => {
    descriptionValueRef.current = description;
  }, [description]);

  // US-5: read a newly selected photo and offer a starting description. The
  // suggestion only fills the private notes when they are empty (or still hold
  // the previous suggestion), so a staffer's own words are never overwritten.
  useEffect(() => {
    captionControllerRef.current?.abort();

    if (!photo?.file) {
      setCaptionSuggestion(null);
      if (autoFilledCaptionRef.current) {
        setDescription((current) =>
          current.trim() === autoFilledCaptionRef.current ? '' : current,
        );
        autoFilledCaptionRef.current = '';
      }
      return undefined;
    }

    const controller = new AbortController();
    captionControllerRef.current = controller;
    setCaptionSuggestion({ status: 'loading' });

    captionImage(photo.file, controller.signal)
      .then(({ caption }) => {
        if (controller.signal.aborted) return;

        const text = caption.trim().slice(0, MAX_DESCRIPTION_LENGTH);
        if (!text) {
          setCaptionSuggestion({
            status: 'error',
            message:
              'We could not read this photo. Write the description yourself.',
          });
          return;
        }

        const current = descriptionValueRef.current.trim();
        const shouldApply =
          !current || current === autoFilledCaptionRef.current;
        if (shouldApply) {
          autoFilledCaptionRef.current = text;
          descriptionValueRef.current = text;
          setDescription(text);
        }
        setCaptionSuggestion({ status: 'ready', text });
      })
      .catch((captionError) => {
        if (controller.signal.aborted || captionError.name === 'AbortError')
          return;
        if (import.meta.env.DEV)
          console.warn('[StaffIntakeForm] caption', captionError);
        setCaptionSuggestion({
          status: 'error',
          message:
            'We could not read this photo automatically. Write the description yourself.',
        });
      })
      .finally(() => {
        if (captionControllerRef.current === controller) {
          captionControllerRef.current = null;
        }
      });

    return () => controller.abort();
  }, [photo, captionAttempt]);

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

  function applyCaptionSuggestion() {
    if (captionSuggestion?.status !== 'ready') return;
    autoFilledCaptionRef.current = captionSuggestion.text;
    descriptionValueRef.current = captionSuggestion.text;
    setDescription(captionSuggestion.text);
    descriptionRef.current?.focus();
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
        aiCaption:
          captionSuggestion?.status === 'ready' ? captionSuggestion.text : null,
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
    captionControllerRef.current?.abort();
    autoFilledCaptionRef.current = '';
    descriptionValueRef.current = '';
    setCaptionSuggestion(null);
    setCaptionAttempt(0);
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

    const stylesheet = new URL('/print.css', document.baseURI).href;

    win.document.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Custody receipt ${escapeHtml(current.refCode)}</title>
<link rel="stylesheet" href="${escapeHtml(stylesheet)}">
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
      <section className="state state--success receipt-panel" role="status">
        <h2 className="state__title" tabIndex={-1} ref={receiptRef}>
          Item taken into custody
        </h2>
        <p className="state__text">
          The item is logged to {receipt.officeName} and is now searchable. Give
          the reference below to whoever handed it in.
        </p>
        <p className="receipt" ref={refCodeRef}>
          <span className="visually-hidden">Custody reference </span>
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
          <p className="state__text">
            The photo was saved, but we could not read it for matching — this
            item is searchable by its text details alone.
          </p>
        )}
        {copyNote && <p className="state__text">{copyNote}</p>}
        <div className="state__actions receipt-actions">
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
      className="form"
      aria-label="Log a found item into custody"
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
          required
          value={title}
          aria-describedby={error ? `${titleHintId} ${errorId}` : titleHintId}
          aria-invalid={error && !title.trim() ? 'true' : undefined}
          onChange={(event) => {
            setTitle(event.target.value);
            if (error) setError('');
          }}
        />
        <p className="field__hint" id={titleHintId}>
          Shown publicly. Keep it generic; put serial numbers and marks in the
          private notes.
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
          required
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
          required
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
          Staff-only. The exact shelf, locker or bin where you placed it.
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
          required
          value={description}
          aria-describedby={
            error ? `${descriptionHintId} ${errorId}` : descriptionHintId
          }
          aria-invalid={error && !description.trim() ? 'true' : undefined}
          onChange={(event) => {
            descriptionValueRef.current = event.target.value;
            setDescription(event.target.value);
            if (error) setError('');
          }}
        />
        <p className="field__hint" id={descriptionHintId}>
          Staff-only. Serial numbers, marks, contents and condition — what the
          desk checks a claim against.
        </p>
        {photo && captionSuggestion && (
          <div className="caption-suggestion" aria-live="polite">
            <p className="caption-suggestion__label">
              <Icon name="lightbulb" />
              Suggested description from the photo
            </p>
            {captionSuggestion.status === 'loading' && (
              <p className="field__hint">Reading the photo…</p>
            )}
            {captionSuggestion.status === 'ready' && (
              <>
                <p className="caption-suggestion__text">
                  {captionSuggestion.text}
                </p>
                {suggestionApplied ? (
                  <p className="field__hint">
                    Added to the private verification notes. Edit or confirm it
                    before taking custody.
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={applyCaptionSuggestion}
                  >
                    <Icon name="check" />
                    Use this description
                  </button>
                )}
              </>
            )}
            {captionSuggestion.status === 'error' && (
              <>
                <p className="field__hint">{captionSuggestion.message}</p>
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => setCaptionAttempt((attempt) => attempt + 1)}
                >
                  <Icon name="refresh" />
                  Try again
                </button>
              </>
            )}
          </div>
        )}
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
          required
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
              required={isCash}
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
            <span>{photo ? 'Change photo' : 'Add photo'}</span>
            <small>(JPG, PNG or WebP, up to 8 MB)</small>
          </span>
        </button>
        <p className="field__hint" id={photoId}>
          Required. Stored so people can recognise the item. Avoid photographing
          people or personal details.
        </p>
        <p className="photo-tip">
          <Icon name="lightbulb" />
          <span>
            Photograph the whole item, not ID cards, serial stickers or
            passcode screens.
          </span>
        </p>
      </div>

      {photo && (
        <div className="photo-chip">
          <img
            className="photo-chip__img"
            src={photo.url}
            alt="Preview of the photo you selected"
            width="48"
            height="48"
            decoding="async"
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
          <p className="form-error" id={errorId}>
            <Icon name="error" />
            {error}
          </p>
        )}
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn--filled" disabled={submitting}>
          <Icon name="login" />
          {submitting ? 'Filing the custody record…' : 'Take into custody'}
        </button>
      </div>
    </form>
  );
}
