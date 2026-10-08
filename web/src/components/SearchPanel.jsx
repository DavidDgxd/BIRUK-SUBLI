import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';

const COLORS = ['Black', 'White', 'Gray', 'Brown', 'Red', 'Blue', 'Green', 'Yellow'];
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_QUERY_LENGTH = 200;

/*
 * Public search entry point (no account required).
 *
 * On submit it navigates to /search with:
 *   - ?q=<text>        free text, English or Filipino
 *   - ?color=<color>   optional lowercase color filter
 *   - location.state.photo = File (optional, lost on page reload)
 * The results page owns translation, embedding and ranking.
 */
export default function SearchPanel() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const queryInputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [color, setColor] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [photo, setPhoto] = useState(null); // { file, url }
  const [error, setError] = useState('');

  const headingId = useId();
  const hintId = useId();
  const errorId = useId();
  const filtersId = useId();

  // Release the preview URL when the photo is replaced, removed or unmounted.
  useEffect(() => {
    if (!photo) return undefined;
    return () => URL.revokeObjectURL(photo.url);
  }, [photo]);

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

  function handleSubmit(event) {
    event.preventDefault();
    const text = query.trim();

    if (!text && !photo) {
      setError('Describe your item or upload a photo to search.');
      queryInputRef.current?.focus();
      return;
    }

    const params = new URLSearchParams();
    if (text) params.set('q', text);
    if (color) params.set('color', color.toLowerCase());

    navigate(
      { pathname: '/search', search: params.toString() },
      { state: photo ? { photo: photo.file } : undefined },
    );
  }

  function clearQuery() {
    setQuery('');
    queryInputRef.current?.focus();
  }

  const describedBy = error ? `${hintId} ${errorId}` : hintId;

  return (
    <section aria-labelledby={headingId}>
      <h2 className="search__title" id={headingId}>
        Search your Items
      </h2>
      <p className="search__subtitle">Search via description and color</p>

      <form role="search" onSubmit={handleSubmit} noValidate>
        <div className="search-field" data-invalid={error ? 'true' : undefined}>
          <Icon name="search" />
          <label className="visually-hidden" htmlFor="item-query">
            Item description and color
          </label>
          <input
            id="item-query"
            ref={queryInputRef}
            className="search-field__input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={MAX_QUERY_LENGTH}
            placeholder="Item description and color"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (error) setError('');
            }}
            aria-describedby={describedBy}
            aria-invalid={error ? 'true' : undefined}
          />
          {query && (
            <button
              type="button"
              className="icon-btn"
              onClick={clearQuery}
              aria-label="Clear search text"
            >
              <Icon name="close" />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-label="Filter by color"
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
          >
            <Icon name="tune" />
          </button>
        </div>

        <p className="search__hint" id={hintId}>
          Works in English or Filipino, like &ldquo;itim na pitaka&rdquo; or
          &ldquo;blue water bottle&rdquo;.
        </p>
        <div aria-live="polite">
          {error && (
            <p className="search__error" id={errorId}>
              <Icon name="error" />
              {error}
            </p>
          )}
        </div>

        {filtersOpen && (
          <div
            className="chip-group"
            id={filtersId}
            role="group"
            aria-label="Color"
          >
            {COLORS.map((name) => (
              <button
                key={name}
                type="button"
                className="chip"
                aria-pressed={color === name}
                onClick={() => setColor(color === name ? null : name)}
              >
                {color === name && <Icon name="check" />}
                {name}
              </button>
            ))}
          </div>
        )}

        <div className="search__actions">
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
          >
            <Icon name="photo_camera" />
            <span className="btn__label">
              <span>Upload Photo</span>
              <small>{photo ? 'Change photo' : '(Optional)'}</small>
            </span>
          </button>
          <button type="submit" className="btn btn--filled">
            <Icon name="search" />
            Find Item Now
          </button>
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
              <small>Photo will be used to match similar items</small>
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
      </form>
    </section>
  );
}
