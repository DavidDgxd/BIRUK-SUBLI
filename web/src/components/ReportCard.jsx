import { useId } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

/** tone: 'lost' (strawberry) or 'found' (ube). */
export default function ReportCard({
  tone,
  badgeIcon,
  title,
  description,
  to,
  ctaIcon,
  ctaLabel,
}) {
  const headingId = useId();

  return (
    <section
      className={`report-card report-card--${tone}`}
      aria-labelledby={headingId}
    >
      <div className="report-card__top">
        <div className="report-card__badge">
          <Icon name={badgeIcon} />
        </div>
        <div>
          <h2 className="report-card__title" id={headingId}>
            {title}
          </h2>
          <p className="report-card__desc">{description}</p>
        </div>
      </div>
      <Link className="btn btn--tonal btn--block" to={to}>
        <Icon name={ctaIcon} />
        {ctaLabel}
        <Icon name="arrow_forward" />
      </Link>
    </section>
  );
}
