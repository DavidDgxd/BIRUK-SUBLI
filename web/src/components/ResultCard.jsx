import { useState } from 'react';
import Icon from './Icon.jsx';
import { calibrateMatchScore } from '../lib/searchItems.js';

export default function ResultCard({ item }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = item.image_url && !imageFailed;
  const { percent, tier } = calibrateMatchScore(item.similarity);

  return (
    <article className="result-card">
      <div className="result-card__media">
        {showImage ? (
          <img
            src={item.image_url}
            alt={`Photo of ${item.title}`}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div
            className="result-card__no-photo"
            role="img"
            aria-label="No photo available"
          >
            <Icon name="hide_image" />
          </div>
        )}
      </div>

      <div className="result-card__body">
        <div className="result-card__head">
          <h3 className="result-card__title">{item.title}</h3>
          <span className={`result-card__badge result-card__badge--${tier}`}>
            {percent}% Match
          </span>
        </div>
        <p className="result-card__ref">
          Ref {item.ref_code}
          {import.meta.env.DEV &&
            ` · score ${item.similarity.toFixed(3)} (dev only)`}
        </p>
        <p className="result-card__category">
          <Icon name="category" />
          {item.category}
        </p>

        <p className="result-card__verify">
          <Icon name="verified_user" />
          <span>
            Verification required at the desk: bring a valid ID and be ready to
            describe unique marks, serial numbers, or condition.
          </span>
        </p>

        <div className="result-card__office">
          <p className="result-card__office-name">
            <Icon name="location_on" />
            <span>
              <span className="visually-hidden">Held at </span>
              {item.holding_office_name}
            </span>
          </p>
          <p className="result-card__office-line">
            <Icon name="map" />
            <span>{item.office_address}</span>
          </p>
          <p className="result-card__office-line">
            <Icon name="schedule" />
            <span>{item.counter_hours}</span>
          </p>
        </div>
      </div>
    </article>
  );
}
