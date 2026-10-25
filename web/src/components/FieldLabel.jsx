/*
 * Visible label for a report-form field.
 *
 * A required field's control carries the native `required` attribute, which
 * screen readers announce; the asterisk is only the visual cue, explained by
 * the legend at the top of the form, so it is hidden from assistive tech.
 * Optional fields say so in words rather than leaving it to be inferred.
 */
export default function FieldLabel({ htmlFor, required = false, children }) {
  return (
    <label className="field__label" htmlFor={htmlFor}>
      {children}
      {required ? (
        <span className="field__required" aria-hidden="true">
          *
        </span>
      ) : (
        <span className="field__optional">(optional)</span>
      )}
    </label>
  );
}
