import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
 */
export default function SearchPanel() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const queryInputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [photo, setPhoto] = useState(null); // { file, url }
  const [error, setError] = useState('');

  const hintId = useId();
  const errorId = useId();

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

    const params = new URLSearchParams();
    if (text) params.set('q', text);

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
    <section className="search" aria-label="Search held items">
      <form
        role="search"
        aria-label="Search held items"
        onSubmit={handleSubmit}
        noValidate
      >
        <label className="field__label" htmlFor="item-query">
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
              id="item-query"
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
