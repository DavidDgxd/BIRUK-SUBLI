import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { resetOfficeCredentials } from '../lib/offices.js';

/*
 * Reset an office's shared login (US-03).
 *
 * Two stages, because the action is destructive: the first names the
 * consequences and asks, the second shows the new credential. That credential
 * is generated server-side and returned exactly once — nothing stores it — so
 * the second stage says so plainly and copying it is the main way out.
 */
export default function ResetCredentialsDialog({ open, office, onClose }) {
  const dialogRef = useRef(null);
  const receiptRef = useRef(null);
  const copyButtonRef = useRef(null);

  const [stage, setStage] = useState('confirm'); // 'confirm' | 'done'
  const [credential, setCredential] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyNote, setCopyNote] = useState('');

  const titleId = useId();
  const errorId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Clear the credential on the way in *and* on the way out: it exists only
  // for as long as it is on screen. Starting from the confirmation also means a
  // password from a previous office is never left showing behind the next one.
  useEffect(() => {
    setStage('confirm');
    setCredential(null);
    setError('');
    setSubmitting(false);
    setCopied(false);
    setCopyNote('');
  }, [open]);

  // Land on the copy button once the credential appears — it is the one thing
  // the admin has to do before closing.
  useEffect(() => {
    if (stage === 'done') copyButtonRef.current?.focus();
  }, [stage]);

  function handleBackdropClick(event) {
    // On the credential stage the dialog holds the only copy of the new
    // password, so it closes on an explicit choice — a stray click outside
    // must not throw the credential away.
    if (event.target === dialogRef.current && stage !== 'done') onClose();
  }

  function handleCancel(event) {
    // Same reason: Escape would discard an unsaved password.
    if (stage === 'done') event.preventDefault();
  }

  async function handleReset() {
    if (submitting || !office) return;
    setError('');
    setSubmitting(true);
    try {
      const result = await resetOfficeCredentials(office.id);
      setCredential(result.credential);
      setStage('done');
    } catch (resetError) {
      if (import.meta.env.DEV) {
        console.error('[ResetCredentialsDialog]', resetError);
      }
      setError(
        resetError?.code === 'reset'
          ? resetError.message
          : 'We could not reset the login right now. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCredential() {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(
        `${credential.email}\n${credential.password}`,
      );
      setCopied(true);
      setCopyNote('');
    } catch {
      // Clipboard access is unavailable (older browsers, non-secure origin);
      // select the password so the admin can copy it by hand.
      const node = receiptRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopyNote('Copy failed — the password is selected, press Ctrl/Cmd+C.');
    }
  }

  const officeName = office?.name ?? 'this office';

  return (
    <dialog
      ref={dialogRef}
      className="office-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
    >
      <div className="office-dialog__form" aria-busy={submitting}>
        <header className="office-dialog__head">
          <h2 className="office-dialog__title" id={titleId}>
            {stage === 'done' ? 'New shared login' : 'Reset shared login'}
          </h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </header>

        {stage === 'done' && credential ? (
          <>
            <p className="office-dialog__lead">
              Give these to {officeName}. The change is already live.
            </p>

            <div className="credential">
              <p className="credential__label">Login email</p>
              <p className="credential__email">{credential.email}</p>

              <p className="credential__label">New shared password</p>
              <p className="receipt credential__password" ref={receiptRef}>
                <span className="visually-hidden">New shared password </span>
                {credential.password}
              </p>
            </div>

            <p className="credential__note">
              <Icon name="priority_high" />
              Copy it now — this is the only time it is shown. Nothing stores
              the password, so it cannot be looked up later; if it goes missing,
              reset it again.
            </p>

            <div aria-live="polite">
              {copyNote && <p className="state-card__text">{copyNote}</p>}
            </div>

            <div className="report-form__actions">
              <button
                type="button"
                className="btn btn--filled"
                ref={copyButtonRef}
                onClick={copyCredential}
              >
                <Icon name={copied ? 'check' : 'content_copy'} />
                {copied ? 'Copied' : 'Copy credentials'}
              </button>
              <button type="button" className="btn" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="office-dialog__lead">
              Issue a new shared password for {officeName}. Use this when the
              office reports its login lost or compromised.
            </p>

            <p className="office-dialog__warning">
              <Icon name="warning" />
              The current password stops working immediately, and anyone signed
              in at {officeName} is signed out. The office will need the new
              password before it can log items again.
            </p>

            <div aria-live="polite">
              {error && (
                <p className="search__error" id={errorId}>
                  <Icon name="error" />
                  {error}
                </p>
              )}
            </div>

            <div className="report-form__actions">
              <button
                type="button"
                className="btn btn--filled"
                onClick={handleReset}
                disabled={submitting || !office}
              >
                <Icon name="lock_reset" />
                {submitting ? 'Resetting…' : 'Reset password'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
