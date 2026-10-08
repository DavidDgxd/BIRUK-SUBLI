import { Link } from 'react-router-dom';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        Biruk-Subli is the City of Baguio&rsquo;s lost-and-found service. Items
        are held and released only at participating city offices.
      </p>
      <Link className="site-footer__link" to="/admin/offices">
        Central admin
      </Link>
    </footer>
  );
}
