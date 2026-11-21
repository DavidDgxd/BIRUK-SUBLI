import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { calibrateMatchScore } from '../lib/searchItems.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function receivedLabel(value) {
  const [year, month, day] = (value ?? '').split('-').map(Number);
  if (!year || !month || !day || !MONTHS[month - 1]) return '';
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export default function ResultCard({ item, possible = false, browse = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = item.image_url && !imageFailed;
  const percent = browse ? null : calibrateMatchScore(item.similarity).percent;
  const status = item.status === 'held' ? 'Held for collection' : item.status;
  const received = browse ? receivedLabel(item.date_received) : '';
  const office = browse
    ? [item.category, item.holding_office_name].filter(Boolean).join(' · ')
    : item.holding_office_name;

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
        <h3 className="result__title">
          {/* The link owns the whole row through a stretched overlay, so one
              control opens the details and its name is the item. A real anchor
              keeps open-in-new-tab and middle-click working. The score rides
              along in router state so the detail page can show the match. */}
          <Link
            className="result__link"
            to={`/items/${item.id}`}
            state={{ similarity: possible ? null : item.similarity }}
          >
            {item.title}
          </Link>
        </h3>
        <p className="result__office">{office}</p>
        <p className="result__status">
          <span className="dot" aria-hidden="true" />
          <span>
            {status}
            {!possible && Number.isFinite(percent)
              ? `, ${percent}% match`
              : ''}
            {received ? ` · Received ${received}` : ''}
          </span>
        </p>
      </div>
    </article>
  );
}
