export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__brand">
        <span className="site-footer__name">University of Baguio</span>
        <span className="site-footer__system">Lost &amp; Found System</span>
        <span className="site-footer__tagline">Biruk-Subli</span>
      </div>
      <p>
        Items are held and released only at participating office counters. Bring
        a valid ID to collect an item.
      </p>
      <p className="site-footer__disclosure">
        University capstone demo. Not an official University of Baguio service.
      </p>
    </footer>
  );
}
