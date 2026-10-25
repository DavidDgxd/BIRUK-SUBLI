import { useState } from 'react';
import Icon from './Icon.jsx';

/*
 * Photo picker for the report forms.
 *
 * The surface is a real file input stretched over the zone at zero opacity, so
 * clicking, tapping, Tab then Enter or Space, and dropping a file all go
 * through the browser's own control and land in `onChange`. Drag state only
 * changes the styling. The chosen file is shown in a polite live region so a
 * screen reader hears which photo was picked, with a button to remove it.
 */
export default function PhotoDropzone({
  id,
  inputRef,
  accept,
  required = false,
  invalid = false,
  describedBy,
  photo,
  photoNote,
  onChange,
  onRemove,
}) {
  const [dragging, setDragging] = useState(false);

  function removePhoto() {
    onRemove();
    inputRef.current?.focus();
  }

  return (
    <>
      <div
        className={`dropzone${dragging ? ' dropzone--drag' : ''}`}
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDrop={() => setDragging(false)}
      >
        <input
          id={id}
          ref={inputRef}
          className="dropzone__input"
          type="file"
          accept={accept}
          required={required}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy}
          onChange={onChange}
        />
        <Icon name="photo_camera" />
        <span className="dropzone__text">
          {photo ? 'Browse or drag to replace photo' : 'Browse file or drag photo here'}
        </span>
      </div>

      <div className="dropzone__status" aria-live="polite">
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
              <span className="photo-chip__file" title={photo.file.name}>
                {photo.file.name}
              </span>
              <small>{photoNote}</small>
            </p>
            <button
              type="button"
              className="icon-btn"
              onClick={removePhoto}
              aria-label="Remove photo"
            >
              <Icon name="close" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
