import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import FieldLabel from './FieldLabel.jsx';
import PhotoDropzone from './PhotoDropzone.jsx';
import { submitLostReport, buildCloseLink } from '../lib/lostReport.js';

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
export default function LostReportForm({ onReceiptChange }) {
  const [description, setDescription] = useState('');
  const [areaRoute, setAreaRoute] = useState('');
  const [dateLost, setDateLost] = useState(todayIso);
  const [contactInfo, setContactInfo] = useState('');
  const [photo, setPhoto] = useState(null); // { file, url }
  const [error, setError] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'done'
  const [receipt, setReceipt] = useState(null); // { refCode, closeKey, usedPhoto }
  const [copyState, setCopyState] = useState('idle'); // 'idle' | 'copied' | 'fallback'

  const descriptionRef = useRef(null);
  const areaRouteRef = useRef(null);
  const dateLostRef = useRef(null);
  const fileInputRef = useRef(null);
  const receiptRef = useRef(null);
  const closeLinkRef = useRef(null);
  const controllerRef = useRef(null);

  const descriptionId = useId();
  const descriptionHintId = useId();
  const areaId = useId();
  const areaHintId = useId();
  const dateId = useId();
  const contactId = useId();
  const contactHintId = useId();
  const photoId = useId();
  const photoHintId = useId();
  const errorId = useId();
  const closeLinkId = useId();
  const closeLinkHintId = useId();
  const receiptTitleId = useId();

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

  // Let the page swap its heading and lead for the receipt state.
  useEffect(() => {
    onReceiptChange?.(status === 'done');
  }, [status, onReceiptChange]);

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

  async function handleCopyLink(closeLink) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(closeLink);
      setCopyState('copied');
    } catch {
      // Clipboard access can be denied by the browser. Selecting the field
      // leaves the link ready for the keyboard shortcut instead.
      setCopyState('fallback');
      closeLinkRef.current?.focus();
      closeLinkRef.current?.select();
    }
  }

  function startAnother() {
    setDescription('');
    setAreaRoute('');
    setDateLost(todayIso());
    setContactInfo('');
    setPhoto(null);
    setReceipt(null);
    setCopyState('idle');
    setError('');
    setStatus('idle');
  }

  if (status === 'done' && receipt) {
    const closeLink = buildCloseLink({
      refCode: receipt.refCode,
      closeKey: receipt.closeKey,
    });

    return (
      <section
        className="state state--success receipt-panel"
        role="status"
        aria-labelledby={receiptTitleId}
      >
        <h2 className="receipt-panel__title" id={receiptTitleId}>
          Save your receipt
        </h2>
        <dl className="receipt-details">
          <div className="receipt-details__row">
            <dt>Reference code</dt>
            <dd>
              <p className="receipt" tabIndex={-1} ref={receiptRef}>
                {receipt.refCode}
              </p>
            </dd>
          </div>
          <div className="receipt-details__row">
            <dt>
              <label htmlFor={closeLinkId}>Private close link</label>
            </dt>
            <dd>
              <input
                id={closeLinkId}
                ref={closeLinkRef}
                className="field__control receipt-link"
                type="text"
                readOnly
                value={closeLink}
                aria-describedby={closeLinkHintId}
                onFocus={(event) => event.target.select()}
              />
              <p className="field__hint" id={closeLinkHintId}>
                Anyone with this link can close the report. Keep it private.
              </p>
            </dd>
          </div>
        </dl>

        <div className="receipt-copy">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => handleCopyLink(closeLink)}
          >
            <Icon name="content_copy" />
            {copyState === 'copied' ? 'Copied!' : 'Copy close link'}
          </button>
          <p className="receipt-copy__status" role="status" aria-live="polite">
            {copyState === 'fallback'
              ? 'Copy is blocked here. The link is selected — press Ctrl+C or Cmd+C.'
              : copyState === 'copied'
                ? 'Private close link copied.'
                : ''}
          </p>
        </div>

        <p className="receipt-warning">
          <Icon name="warning" />
          <span>
            Save this link and reference code now. The private close link is
            shown only once and cannot be recovered. Once you find your item,
            open the link and confirm to stop new matches.
          </span>
        </p>

        <p className="state__text">
          Keep this reference code. Staff will ask for it when an item matching
          your description is handed in at a counter.
        </p>
        {photo && !receipt.usedPhoto && (
          <p className="state__text">
            We could not read your photo, so your report was matched on the
            description alone.
          </p>
        )}
        <p className="state__text">
          We will match new items against your description automatically. There
          is no need to file again.
        </p>
        <div className="state__actions receipt-actions">
          <Link className="btn btn--primary" to="/">
            <Icon name="search" />
            Search held items
          </Link>
          <button type="button" className="btn btn--quiet" onClick={startAnother}>
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
      className="form"
      aria-label="Report a lost item"
      onSubmit={handleSubmit}
      noValidate
      aria-busy={submitting}
    >
      <p className="form__legend form__legend--required">
        Fields marked * are required.
      </p>

      <div className="field">
        <FieldLabel htmlFor={descriptionId} required>
          What did you lose?
        </FieldLabel>
        <textarea
          id={descriptionId}
          ref={descriptionRef}
          className="field__control field__control--area"
          rows={4}
          maxLength={MAX_DESCRIPTION_LENGTH}
          placeholder="Blue backpack with a white logo, laptop inside"
          required
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
        <FieldLabel htmlFor={areaId} required>
          Where do you think you lost it?
        </FieldLabel>
        <input
          id={areaId}
          ref={areaRouteRef}
          className="field__control"
          type="text"
          maxLength={MAX_SHORT_LENGTH}
          placeholder="UB Cardinals Gym, or the covered walk from the main gate"
          required
          value={areaRoute}
          aria-describedby={error ? `${areaHintId} ${errorId}` : areaHintId}
          aria-invalid={error && !areaRoute.trim() ? 'true' : undefined}
          onChange={(event) => {
            setAreaRoute(event.target.value);
            if (error) setError('');
          }}
        />
        <p className="field__hint" id={areaHintId}>
          A street, landmark or the route you were travelling.
        </p>
      </div>

      <div className="field">
        <FieldLabel htmlFor={dateId} required>
          When did you lose it?
        </FieldLabel>
        <input
          id={dateId}
          ref={dateLostRef}
          className="field__control"
          type="date"
          max={todayIso()}
          required
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
        <FieldLabel htmlFor={contactId}>Contact information</FieldLabel>
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
        <FieldLabel htmlFor={photoId}>Photo</FieldLabel>
        <PhotoDropzone
          id={photoId}
          inputRef={fileInputRef}
          accept={ACCEPTED_TYPES.join(',')}
          describedBy={error ? `${photoHintId} ${errorId}` : photoHintId}
          photo={photo}
          photoNote="Used once to improve matching"
          onChange={handleFileChange}
          onRemove={() => setPhoto(null)}
        />
        <p className="field__hint" id={photoHintId}>
          JPG, PNG or WebP, up to 8 MB. A photo is matched against your
          description. It is not stored with your report.
        </p>
      </div>

      <div aria-live="polite">
        {error && (
          <p className="form-error" id={errorId}>
            <Icon name="error" />
            {error}
          </p>
        )}
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          <Icon name="send" />
          {submitting ? 'Filing your report…' : 'Submit report'}
        </button>
      </div>
    </form>
  );
}
