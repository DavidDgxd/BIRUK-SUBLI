import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { submitLostReport } from '../lib/lostReport.js';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_SHORT_LENGTH = 120;

const ERROR_COPY = {
  'ai-unreachable':
    'We could not reach the matching service. Please try again in a moment.',
  'ai-failed': 'The matching service ran into a problem. Please try again.',
  'ai-bad-response':
    'The matching service sent something unexpected. Please try again.',
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
 * Public lost-item report form. No account needed.
 *
 * On success it shows the reference code the database generated. Reports are
 * matched against held items behind the scenes; staff quote the code at the
 * counter, which is why it is the one thing we must give back.
 */
export default function LostReportForm() {
  const [description, setDescription] = useState('');
  const [areaRoute, setAreaRoute] = useState('');
  const [dateLost, setDateLost] = useState(todayIso);
  const [contactInfo, setContactInfo] = useState('');
  const [photo, setPhoto] = useState(null); // { file, url }
  const [error, setError] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'done'
  const [receipt, setReceipt] = useState(null); // { refCode, usedPhoto }

  const descriptionRef = useRef(null);
  const areaRouteRef = useRef(null);
  const dateLostRef = useRef(null);
  const fileInputRef = useRef(null);
  const receiptRef = useRef(null);
  const controllerRef = useRef(null);

  const descriptionId = useId();
  const descriptionHintId = useId();
  const areaId = useId();
  const areaHintId = useId();
  const dateId = useId();
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

    const trimmedDescription = description.trim();
    const trimmedArea = areaRoute.trim();

    if (!trimmedDescription) {
      setError('Describe the item you lost.');
      descriptionRef.current?.focus();
      return;
    }
    if (!trimmedArea) {
      setError('Tell us where you think you lost it.');
      areaRouteRef.current?.focus();
      return;
    }
    if (!dateLost) {
      setError('Choose the date you lost it.');
      dateLostRef.current?.focus();
      return;
    }
    if (dateLost > todayIso()) {
      setError('The date you lost it cannot be in the future.');
      dateLostRef.current?.focus();
      return;
    }

    setError('');
    setStatus('submitting');

    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await submitLostReport({
        description: trimmedDescription,
        areaRoute: trimmedArea,
        dateLost,
        contactInfo,
        photo: photo?.file ?? null,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setReceipt(result);
      setStatus('done');
    } catch (submitError) {
      if (controller.signal.aborted || submitError.name === 'AbortError')
        return;
      if (import.meta.env.DEV) console.error('[LostReportForm]', submitError);
      setStatus('idle');
      setError(ERROR_COPY[submitError.code] ?? ERROR_COPY.db);
    } finally {
      controllerRef.current = null;
    }
  }

  function startAnother() {
    setDescription('');
    setAreaRoute('');
    setDateLost(todayIso());
    setContactInfo('');
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
          Keep this reference code. Staff will ask for it when an item matching
          your description is handed in at a counter.
        </p>
        <p className="receipt" aria-label={`Reference code ${receipt.refCode}`}>
          {receipt.refCode}
        </p>
        {photo && !receipt.usedPhoto && (
          <p className="state-card__text">
            We could not read your photo, so your report was matched on the
            description alone.
          </p>
        )}
        <p className="state-card__text">
          We will match new items against your description automatically. There
          is no need to file again.
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
        <label className="field__label" htmlFor={descriptionId}>
          What did you lose?
        </label>
        <textarea
          id={descriptionId}
          ref={descriptionRef}
          className="field__control field__control--area"
          rows={4}
          maxLength={MAX_DESCRIPTION_LENGTH}
          placeholder="Blue backpack with a white logo, laptop inside"
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
          Colour, brand, marks and contents all help matching. English or
          Filipino is fine.
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={areaId}>
          Where do you think you lost it?
        </label>
        <input
          id={areaId}
          ref={areaRouteRef}
          className="field__control"
          type="text"
          maxLength={MAX_SHORT_LENGTH}
          placeholder="Session Road, or jeepney to Aurora Hill"
          value={areaRoute}
          aria-describedby={error ? `${areaHintId} ${errorId}` : areaHintId}
          aria-invalid={error && !areaRoute.trim() ? 'true' : undefined}
          onChange={(event) => {
            setAreaRoute(event.target.value);
            if (error) setError('');
          }}
        />
        <p className="field__hint" id={areaHintId}>
          A street, landmark, or the route you were travelling.
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={dateId}>
          When did you lose it?
        </label>
        <input
          id={dateId}
          ref={dateLostRef}
          className="field__control"
          type="date"
          max={todayIso()}
          value={dateLost}
          aria-invalid={error && !dateLost ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setDateLost(event.target.value);
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
          value={contactInfo}
          aria-describedby={contactHintId}
          onChange={(event) => setContactInfo(event.target.value)}
        />
        <p className="field__hint" id={contactHintId}>
          Only counter staff can see this. It is used to reach you if your item
          turns up.
        </p>
      </div>

      <div className="field">
        <span className="field__label">
          Photo <span className="field__optional">Optional</span>
        </span>
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
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          aria-describedby={photoId}
        >
          <Icon name="photo_camera" />
          <span className="btn__label">
            <span>Upload Photo</span>
            <small>
              {photo ? 'Change photo' : '(JPG, PNG or WebP, up to 8 MB)'}
            </small>
          </span>
        </button>
        <p className="field__hint" id={photoId}>
          A photo is matched against your description. It is not stored with
          your report.
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
            <small>Used once to improve matching</small>
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
