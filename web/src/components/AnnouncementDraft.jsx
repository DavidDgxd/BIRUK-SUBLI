import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import {
  captionImageOrNull,
  captionImageFromUrlOrNull,
} from '../lib/aiService.js';
import { captionSource } from '../lib/captionSuggestion.js';
import {
  buildAnnouncementDrafts,
  copyAnnouncement,
  sanitizeAnnouncementText,
  updateAnnouncementDraft,
} from '../lib/announcementDraft.js';

const CAPTION_WARNING =
  'We could not read the photo. The draft uses the item title only — add any public details you want to include.';

const buildFor = (item, caption) => {
  const generated = buildAnnouncementDrafts({ ...item, aiCaption: caption });
  return generated.en || generated.tl
    ? { phase: 'ready', en: generated.en, tl: generated.tl }
    : { phase: 'empty', en: '', tl: '' };
};

/* Editable public announcement on the custody receipt (US-24, US-25). Private
 * notes, cash amounts and finder/claimant fields are never passed here. */
export default function AnnouncementDraft({ item }) {
  const {
    title, category, aiCaption, officeName, counterHours,
    isCash, imageUrl, photoFile, photoUrl,
  } = item ?? {};
  const safeTitle = sanitizeAnnouncementText(title, { maxLength: 120 });
  const englishId = useId();
  const filipinoId = useId();
  const hintId = useId();
  const headingId = useId();
  const englishRef = useRef(null);
  const filipinoRef = useRef(null);
  const [draft, setDraft] = useState(() =>
    aiCaption || !(photoFile || photoUrl)
      ? buildFor(item ?? {}, aiCaption)
      : { phase: 'loading', en: '', tl: '' },
  );
  const [notice, setNotice] = useState('');
  const [copyState, setCopyState] = useState('idle'); // idle | en-copied | tl-copied | both-copied | error

  useEffect(() => {
    const source = captionSource({ file: photoFile, url: photoUrl });
    if (aiCaption || !source) return undefined;

    const controller = new AbortController();
    const base = { title, category, officeName, counterHours, isCash };
    setDraft({ phase: 'loading', en: '', tl: '' });
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
  }, [aiCaption, category, counterHours, isCash, officeName, photoFile, photoUrl, title]);

  function editVersion(language, value) {
    setDraft((current) => updateAnnouncementDraft(current, language, value));
    setCopyState('idle');
    setNotice('');
  }
  async function handleCopy(action) {
    if (!draft.en.trim() && !draft.tl.trim()) return;
    try {
      const result = await copyAnnouncement(action, {
        en: draft.en,
        tl: draft.tl,
        photoUrl: imageUrl,
      });
      setCopyState(`${action}-copied`);
      const photoNote = result.photoIncluded
        ? 'Both versions and the photo are on your clipboard.'
        : 'Both versions are on your clipboard. The photo could not be attached.';
      setNotice(action === 'both' ? photoNote : 'Copied to your clipboard.');
    } catch {
      const target = action === 'tl' ? filipinoRef : englishRef;
      target.current?.focus();
      target.current?.select();
      setCopyState('error');
      setNotice('Copy failed — the text is selected, press Ctrl/Cmd+C.');
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
            alt={`Photo of ${safeTitle || 'found item'}`}
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
          <div className="announcement-draft__versions">
            {[
              ['en', 'English announcement', englishRef, englishId],
              ['tl', 'Filipino announcement', filipinoRef, filipinoId],
            ].map(([language, label, ref, id]) => (
              <div key={language}>
                <label className="field__label" htmlFor={id}>
                  {label}
                </label>
                <textarea
                  id={id}
                  ref={ref}
                  className="field__control field__control--area announcement-draft__text"
                  rows={10}
                  lang={language}
                  value={draft[language]}
                  aria-describedby={hintId}
                  onChange={(event) =>
                    editVersion(language, event.target.value)
                  }
                />
              </div>
            ))}
          </div>
          <p className="field__hint" id={hintId}>
            Edit either version before posting. Copy one, or copy both together
            with the item photo.
          </p>

          {notice && (
            <p
              className="announcement-draft__notice"
              role={copyState === 'error' ? 'alert' : 'status'}
            >
              <Icon name={copyState === 'error' ? 'error' : 'info'} />
              {notice}
            </p>
          )}

          <div className="announcement-draft__actions">
            {[
              ['en', 'Copy English', 'English copied', draft.en],
              ['tl', 'Copy Filipino', 'Filipino copied', draft.tl],
              ['both', 'Copy both + photo', 'Copied both', draft.en || draft.tl],
              ['facebook', 'Copy for Facebook', 'Copied for Facebook', draft.en || draft.tl],
            ].map(([action, idle, copied, text]) => (
              <button
                key={action}
                type="button"
                className={action === 'both' ? 'btn btn--filled' : 'btn'}
                onClick={() => handleCopy(action)}
                disabled={!text.trim()}
              >
                <Icon
                  name={copyState === `${action}-copied` ? 'check' : 'content_copy'}
                />
                {copyState === `${action}-copied` ? copied : idle}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
