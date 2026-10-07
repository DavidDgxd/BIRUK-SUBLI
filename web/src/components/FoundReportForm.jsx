import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { submitFoundReport } from '../lib/foundReport.js';
import { ACCEPTED_IMAGE_TYPES, MAX_SOURCE_BYTES } from '../lib/storage.js';

const ACCEPTED_TYPES = ACCEPTED_IMAGE_TYPES;
const MAX_PHOTO_BYTES = MAX_SOURCE_BYTES;
const MAX_NOTE_LENGTH = 500;
const MAX_SHORT_LENGTH = 120;

const ERROR_COPY = {
  'ai-unreachable':
    'We could not reach the matching service. Please try again in a moment.',
  'ai-failed': 'The matching service ran into a problem. Please try again.',
  'ai-bad-response':
    'The matching service sent something unexpected. Please try again.',
  'image-convert':
    'We could not process that photo. Please try a different one.',
  'image-upload': 'We could not upload your photo. Please try again.',
  db: 'We could not save your report right now. Please try again.',
};

/** Local calendar date as YYYY-MM-DD, so the max is today in the citizen's timezone. */
function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

/*
 * Public found-item report form. No account needed.
 *
 * Unlike the lost form, the photo is required and is stored (see storage.js), so
 * the copy has to be explicit that it is uploaded and publicly readable. On
 * success it shows the reference code the database generated; the finder hands
 * the item in at a counter and staff quote that code.
 */
export default function FoundReportForm() {
  const [shortNote, setShortNote] = useState('');
  const [foundLocation, setFoundLocation] = useState('');
  const [foundDate, setFoundDate] = useState(todayIso);
  const [finderContact, setFinderContact] = useState('');
  const [photo, setPhoto] = useState(null); // { file, url }
  const [error, setError] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'done'
  const [receipt, setReceipt] = useState(null); // { refCode, imageUrl, usedPhoto }

  const noteRef = useRef(null);
  const locationRef = useRef(null);
  const foundDateRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadButtonRef = useRef(null);
  const receiptRef = useRef(null);
  const controllerRef = useRef(null);

  const noteId = useId();
  const noteHintId = useId();
  const locationId = useId();
  const locationHintId = useId();
  const foundDateId = useId();
  const contactId = useId();
  const contactHintId = useId();
  const photoId = useId();
  const errorId = useId();

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

    const trimmedNote = shortNote.trim();
    const trimmedLocation = foundLocation.trim();

    if (!trimmedNote) {
      setError('Describe the item you found.');
      noteRef.current?.focus();
      return;
    }
    if (!trimmedLocation) {
      setError('Tell us where you found it.');
      locationRef.current?.focus();
      return;
    }
    if (!foundDate) {
      setError('Choose the date you found it.');
      foundDateRef.current?.focus();
      return;
    }
    if (foundDate > todayIso()) {
      setError('The date you found it cannot be in the future.');
      foundDateRef.current?.focus();
      return;
    }
    if (!photo) {
      setError('Add a photo of the item you found.');
      uploadButtonRef.current?.focus();
      return;
    }

    setError('');
    setStatus('submitting');

    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await submitFoundReport({
        shortNote: trimmedNote,
        foundLocation: trimmedLocation,
        foundDate,
        finderContact,
        photo: photo.file,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setReceipt(result);
      setStatus('done');
    } catch (submitError) {
      if (controller.signal.aborted || submitError.name === 'AbortError')
        return;
      if (import.meta.env.DEV) console.error('[FoundReportForm]', submitError);
      setStatus('idle');
      setError(ERROR_COPY[submitError.code] ?? ERROR_COPY.db);
    } finally {
      controllerRef.current = null;
    }
  }

  function startAnother() {
    setShortNote('');
    setFoundLocation('');
    setFoundDate(todayIso());
    setFinderContact('');
    setPhoto(null);
    setReceipt(null);
    setError('');
    setStatus('idle');
  }

  if (status === 'done' && receipt) {
    return (
      <section className="state-card state-card--success" role="status">
        <h3 className="state-card__title" tabIndex={-1} ref={receiptRef}>
          Report received
        </h3>
        <p className="state-card__text">
          Keep this reference code. Hand the item in at any participating city
          office counter and staff will log it against this code.
        </p>
        <p className="receipt" aria-label={`Reference code ${receipt.refCode}`}>
          {receipt.refCode}
        </p>
        {!receipt.usedPhoto && (
          <p className="state-card__text">
            Your photo was saved, but we could not read it for matching, so your
            report was matched on the description alone.
          </p>
        )}
        <p className="state-card__text">
          Until you hand the item in, it will not appear in the public search.
        </p>
        <div className="state-card__actions">
          <Link className="btn btn--filled" to="/">
            <Icon name="search" />
            Search held items
          </Link>
          <button type="button" className="btn" onClick={startAnother}>
            <Icon name="add" />
            Report another item
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
        <label className="field__label" htmlFor={noteId}>
          What did you find?
        </label>
        <textarea
          id={noteId}
          ref={noteRef}
          className="field__control field__control--area"
          rows={4}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="Black leather wallet with a student ID inside"
          value={shortNote}
          aria-describedby={error ? `${noteHintId} ${errorId}` : noteHintId}
          aria-invalid={error && !shortNote.trim() ? 'true' : undefined}
          onChange={(event) => {
            setShortNote(event.target.value);
            if (error) setError('');
          }}
        />
        <p className="field__hint" id={noteHintId}>
          Colour, brand, marks and contents all help us match it. Do not
          describe the item's full contents — leave something only the owner
          would know.
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={locationId}>
          Where did you find it?
        </label>
        <input
          id={locationId}
          ref={locationRef}
          className="field__control"
          type="text"
          maxLength={MAX_SHORT_LENGTH}
          placeholder="Session Road, near the market entrance"
          value={foundLocation}
          aria-describedby={
            error ? `${locationHintId} ${errorId}` : locationHintId
          }
          aria-invalid={error && !foundLocation.trim() ? 'true' : undefined}
          onChange={(event) => {
            setFoundLocation(event.target.value);
            if (error) setError('');
          }}
        />
        <p className="field__hint" id={locationHintId}>
          A street, landmark, or the route where you picked it up.
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={foundDateId}>
          When did you find it?
        </label>
        <input
          id={foundDateId}
          ref={foundDateRef}
          className="field__control"
          type="date"
          max={todayIso()}
          value={foundDate}
          aria-invalid={error && !foundDate ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setFoundDate(event.target.value);
            if (error) setError('');
          }}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={contactId}>
          Contact information <span className="field__optional">Optional</span>
        </label>
        <input
          id={contactId}
          className="field__control"
          type="text"
          maxLength={MAX_SHORT_LENGTH}
          placeholder="Phone number or email"
          autoComplete="tel"
          value={finderContact}
          aria-describedby={contactHintId}
          onChange={(event) => setFinderContact(event.target.value)}
        />
        <p className="field__hint" id={contactHintId}>
          Only counter staff can see this. It is used to reach you about the
          item you handed in.
        </p>
      </div>

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
          Required. The photo is uploaded and stored with your report so counter
          staff can identify the item. Please do not photograph people, ID
          numbers or other personal details.
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
            <small>Stored with your report</small>
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
          <Icon name="send" />
          {submitting ? 'Filing your report…' : 'Submit Report'}
        </button>
      </div>
    </form>
  );
}
