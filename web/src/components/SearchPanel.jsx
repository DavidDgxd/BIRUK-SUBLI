import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from './Icon.jsx';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_QUERY_LENGTH = 200;

/*
 * Public search entry point (no account required).
 *
 * On submit it navigates to /search with:
 *   - ?q=<text>        free text, English, Filipino or Ilokano
 *   - location.state.photo = File (optional, lost on page reload)
 * The results page owns translation, embedding and ranking.
 *
 * `compact` renders the query field, search button and photo control so the
 * results page can offer an editable search bar without the full helper copy.
 * It keeps the current office/date filters when the query is changed.
 */
export default function SearchPanel({ initialQuery = '', compact = false }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef(null);
  const queryInputRef = useRef(null);
  const [query, setQuery] = useState(initialQuery);
  const [photo, setPhoto] = useState(null); // { file, url }
  const [error, setError] = useState('');

  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  // Keep the field in step when the URL query changes (for example after the
  // results page applies a filter and re-renders).
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

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
      setError('Describe your item or add a photo to search.');
      queryInputRef.current?.focus();
      return;
    }

    const params = compact
      ? new URLSearchParams(searchParams)
      : new URLSearchParams();
    if (text) params.set('q', text);
    else params.delete('q');

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

  if (compact) {
    return (
      <form
        className="search-inline"
        role="search"
        aria-label="Search held items"
        onSubmit={handleSubmit}
        noValidate
      >
        <label className="visually-hidden" htmlFor={inputId}>
          Search held items
        </label>
        <div
          className={`search-inline__field${error ? ' is-invalid' : ''}`}
        >
          <Icon
            name="search"
            className="search-inline__loupe"
            size={18}
            strokeWidth={1.5}
          />
          <input
            id={inputId}
            ref={queryInputRef}
            className="search-inline__input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={MAX_QUERY_LENGTH}
            placeholder="Search for a different item…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (error) setError('');
            }}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? 'true' : undefined}
          />
          {query && (
            <button
              type="button"
              className="icon-btn search-inline__clear"
              onClick={clearQuery}
              aria-label="Clear search text"
            >
              <Icon name="close" size={18} strokeWidth={1.5} />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="btn btn--primary search-inline__submit"
        >
          <Icon name="search" size={17} strokeWidth={1.5} />
          <span>Search</span>
        </button>
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
          className="btn search-inline__attach"
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon name="photo_camera" size={16} strokeWidth={1.5} />
          <span>{photo ? 'Change photo' : 'Add photo'}</span>
        </button>
        {photo && (
          <div className="photo-chip search-inline__photo">
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
              <small>Used to match similar items</small>
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
        <div className="search-inline__error-slot" aria-live="polite">
          {error && (
            <p className="search__error" id={errorId}>
              <Icon name="error" size={18} strokeWidth={1.5} />
              {error}
            </p>
          )}
        </div>
      </form>
    );
  }

  return (
    <section className="search" aria-label="Search held items">
      <form
        role="search"
        aria-label="Search held items"
        onSubmit={handleSubmit}
        noValidate
      >
        <label className="field__label" htmlFor={inputId}>
          Describe the item
        </label>

        <div className="search-console">
          <div className={`search-console__field${error ? ' is-invalid' : ''}`}>
            <Icon
              name="search"
              className="search-console__loupe"
              size={18}
              strokeWidth={1.5}
            />
            <input
              id={inputId}
              ref={queryInputRef}
              className="search__input"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              maxLength={MAX_QUERY_LENGTH}
              placeholder="e.g., umbrella left at Burnham Park, wallet along Session Road..."
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
                className="icon-btn search__clear"
                onClick={clearQuery}
                aria-label="Clear search text"
              >
                <Icon name="close" size={18} strokeWidth={1.5} />
              </button>
            )}
          </div>

          <div className="search-console__actions">
            <button
              type="submit"
              className="btn btn--primary search-console__submit"
            >
              <Icon name="search" size={17} strokeWidth={1.5} />
              <span>Search</span>
            </button>

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
              className="search-console__attach"
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon
                name="photo_camera"
                size={14}
                strokeWidth={1.5}
                className="search-console__camera"
              />
              <span>{photo ? 'Change photo' : 'Add photo'}</span>
            </button>
          </div>
        </div>

        <p className="search__hint" id={hintId}>
          Colour, brand, or unique marks help. English, Filipino, or Ilokano is
          fine.
        </p>

        <div aria-live="polite">
          {error && (
            <p className="search__error" id={errorId}>
              <Icon name="error" size={18} strokeWidth={1.5} />
              {error}
            </p>
          )}
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
              <small>Used to match similar items</small>
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
