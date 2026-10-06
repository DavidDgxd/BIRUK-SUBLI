/* Decorative Material Symbols Rounded icon. Pair with a text label or aria-label on the parent control. */
export default function Icon({ name, className = '' }) {
  return (
    <span className={`icon ${className}`.trim()} aria-hidden="true">
      {name}
    </span>
  );
}
