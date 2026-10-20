import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { calibrateMatchScore } from '../lib/searchItems.js';

export default function ResultCard({ item }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = item.image_url && !imageFailed;
  const { percent } = calibrateMatchScore(item.similarity);
  const status = item.status === 'held' ? 'Held for collection' : item.status;

  return (
    <article className="result">
      {showImage ? (
        <img
          className="result__photo"
          src={item.image_url}
          alt={`Photo of ${item.title}`}
          width="112"
          height="112"
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div
          className="result__no-photo"
          role="img"
          aria-label="No photo available"
        >
          <Icon name="hide_image" />
        </div>
      )}

      <div className="result__body">
        <h2 className="result__title">
          {/* The link owns the whole row through a stretched overlay, so one
              control opens the details and its name is the item. A real anchor
              keeps open-in-new-tab and middle-click working. The score rides
              along in router state so the detail page can show the match. */}
          <Link
            className="result__link"
            to={`/items/${item.id}`}
            state={{ similarity: item.similarity }}
          >
            {item.title}
          </Link>
        </h2>
        <p className="result__office">{item.holding_office_name}</p>
        <p className="result__status">
          <span className="dot" aria-hidden="true" />
          <span>
            {status}
            {typeof percent === 'number' ? `, ${percent}% match` : ''}
          </span>
        </p>
      </div>
    </article>
  );
}
