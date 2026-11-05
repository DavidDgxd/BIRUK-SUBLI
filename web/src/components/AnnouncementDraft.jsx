import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import {
  captionImageOrNull,
  captionImageFromUrlOrNull,
} from '../lib/aiService.js';
import { captionSource } from '../lib/captionSuggestion.js';
import { buildAnnouncementDraft } from '../lib/announcementDraft.js';

const CAPTION_WARNING =
  'We could not read the photo. The draft uses the item title only — add any public details you want to include.';

const buildFor = (item, caption) => {
  const generated = buildAnnouncementDraft({ ...item, aiCaption: caption });
  return generated
    ? { phase: 'ready', generated, body: generated }
    : { phase: 'empty', generated: '', body: '' };
};

/* Editable public announcement on the custody receipt (US-24). Private notes,
 * cash amounts and finder/claimant fields are never passed to the generator. */
export default function AnnouncementDraft({ item }) {
  const {
    title, category, aiCaption, officeName,
    isCash, imageUrl, photoFile, photoUrl,
  } = item;
  const textareaId = useId();
  const hintId = useId();
  const headingId = useId();
  const textareaRef = useRef(null);
  const [draft, setDraft] = useState(() =>
    aiCaption || !(photoFile || photoUrl)
      ? buildFor(item, aiCaption)
      : { phase: 'loading', generated: '', body: '' },
  );
  const [notice, setNotice] = useState('');
  const [copyState, setCopyState] = useState('idle'); // idle | copied | error

  useEffect(() => {
    const source = captionSource({ file: photoFile, url: photoUrl });
    if (aiCaption || !source) return undefined;

    const controller = new AbortController();
    const base = { title, category, officeName, isCash };
    setDraft({ phase: 'loading', generated: '', body: '' });
    setNotice('');

    const caption = source.file
      ? captionImageOrNull(source.file, controller.signal)
      : captionImageFromUrlOrNull(source.url, controller.signal);

    caption
      .then((suggestion) => {
        if (controller.signal.aborted) return;
        setDraft(buildFor(base, suggestion));
        if (!suggestion) setNotice(CAPTION_WARNING);
      })
      .catch((error) => {
        if (controller.signal.aborted || error.name === 'AbortError') return;
        if (import.meta.env.DEV) console.warn('[AnnouncementDraft]', error);
        setDraft(buildFor(base, ''));
        setNotice(CAPTION_WARNING);
      });

    return () => controller.abort();
  }, [aiCaption, category, isCash, officeName, photoFile, photoUrl, title]);

  async function handleCopy() {
    if (!draft.body.trim()) return;
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopyState('copied');
      setNotice('');
    } catch {
      textareaRef.current?.focus();
      textareaRef.current?.select();
      setCopyState('error');
      setNotice('Copy failed — the draft is selected, press Ctrl/Cmd+C.');
    }
  }

  return (
    <section
      className="caption-suggestion announcement-draft"
      aria-labelledby={headingId}
    >
      <div className="announcement-draft__head">
        <div>
          <h3 className="caption-suggestion__label" id={headingId}>
            <Icon name="campaign" />
            Announcement draft
          </h3>
          <p className="field__hint">
            Auto-drafted for your office&rsquo;s public page. Private notes,
            serial numbers, contact details and cash amounts are left out.
          </p>
        </div>
        {imageUrl && (
          <img
            className="announcement-draft__photo"
            src={imageUrl}
            alt={`Photo of ${title}`}
            width="96"
            height="96"
            loading="lazy"
            decoding="async"
          />
        )}
      </div>

      {draft.phase === 'loading' && (
        <p className="loading" role="status">
          <Icon name="hourglass_top" className="icon--pulse" />
          Drafting the announcement…
        </p>
      )}

      {draft.phase === 'empty' && (
        <p className="field__hint" role="status">
          We could not draft an announcement for this item. Add a public title
          above and try again.
        </p>
      )}

      {draft.phase === 'ready' && (
        <>
          <label className="field__label" htmlFor={textareaId}>
            Announcement text
          </label>
          <textarea
            id={textareaId}
            ref={textareaRef}
            className="field__control field__control--area announcement-draft__text"
            rows={10}
            value={draft.body}
            aria-describedby={hintId}
            onChange={(event) => {
              setDraft((current) => ({ ...current, body: event.target.value }));
              setCopyState('idle');
              setNotice('');
            }}
          />
          <p className="field__hint" id={hintId}>
            Edit before posting. The text is copied to your clipboard; attach
            the photo above separately.
          </p>

          {notice && (
            <p
              className="announcement-draft__notice"
              role={copyState === 'error' ? 'status' : 'alert'}
            >
              <Icon name={copyState === 'error' ? 'error' : 'info'} />
              {notice}
            </p>
          )}

          <div className="announcement-draft__actions">
            <button type="button" className="btn btn--filled" onClick={handleCopy}>
              <Icon name={copyState === 'copied' ? 'check' : 'content_copy'} />
              {copyState === 'copied' ? 'Copied' : 'Copy announcement'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
