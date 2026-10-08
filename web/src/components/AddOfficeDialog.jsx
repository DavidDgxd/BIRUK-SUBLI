import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { provisionOffice } from '../lib/offices.js';

const MAX_NAME = 120;
const MAX_ID = 40;
const MAX_ADDRESS = 240;
const MAX_HOURS = 160;
const MAX_PHONE = 40;
const MAX_MAP_PIN = 240;
const MAX_EMAIL = 254;
const MIN_PASSWORD = 8;

const SITE_CODE_PATTERN = /^[A-Z0-9_-]{2,40}$/;

function emptyForm() {
  return {
    name: '',
    id: '',
    address: '',
    counterHours: '',
    phoneNumber: '',
    mapPin: '',
    status: 'active',
    email: '',
    password: '',
  };
}

/*
 * "+ ADD AN OFFICE" dialog (Wireframe Screen 20, US-01).
 *
 * Collects the office directory fields and the office's shared login. The
 * password is the desk's shared credential — everyone at that office signs in
 * with the same email/password (US-02), so the admin shares it out of band.
 * On submit the provision-office Edge Function mints the auth user and inserts
 * the `offices` row.
 */
export default function AddOfficeDialog({ open, onClose, onCreated }) {
  const dialogRef = useRef(null);
  const nameRef = useRef(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const titleId = useId();
  const errorId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Start each open with a blank form.
  useEffect(() => {
    if (open) {
      setForm(emptyForm());
      setError('');
      setSubmitting(false);
    }
  }, [open]);

  function setField(field) {
    return (event) => {
      setForm((previous) => ({ ...previous, [field]: event.target.value }));
      if (error) setError('');
    };
  }

  function handleBackdropClick(event) {
    if (event.target === dialogRef.current) onClose();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const id = form.id.trim().toUpperCase();
    const name = form.name.trim();
    const address = form.address.trim();
    const counterHours = form.counterHours.trim();
    const email = form.email.trim().toLowerCase();

    if (!name) {
      setError('Enter the office name.');
      nameRef.current?.focus();
      return;
    }
    if (!id) {
      setError('Enter a site code for the office.');
      return;
    }
    if (!SITE_CODE_PATTERN.test(id)) {
      setError(
        'Site codes use letters, numbers, underscores and hyphens (2–40 characters).',
      );
      return;
    }
    if (!address) {
      setError('Enter the office address.');
      return;
    }
    if (!counterHours) {
      setError('Enter the counter hours.');
      return;
    }
    if (!email) {
      setError('Enter the shared login email.');
      return;
    }
    if (form.password.length < MIN_PASSWORD) {
      setError(
        `The shared password must be at least ${MIN_PASSWORD} characters.`,
      );
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      const office = await provisionOffice({
        id,
        name,
        address,
        counterHours,
        phoneNumber: form.phoneNumber.trim(),
        mapPin: form.mapPin.trim(),
        status: form.status,
        email,
        password: form.password,
      });
      onCreated(office);
    } catch (submitError) {
      if (import.meta.env.DEV) console.error('[AddOfficeDialog]', submitError);
      setError(
        submitError.code === 'provision'
          ? submitError.message
          : 'We could not create the office right now. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const errorIds = error ? errorId : undefined;

  return (
    <dialog
      ref={dialogRef}
      className="office-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={handleBackdropClick}
    >
      <form
        className="office-dialog__form"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={submitting}
      >
        <header className="office-dialog__head">
          <h2 className="office-dialog__title" id={titleId}>
            Add an office
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

        <p className="office-dialog__lead">
          Provision a shared login and directory entry for a new participating
          office.
        </p>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-name`}>
            Office name
          </label>
          <input
            id={`${titleId}-name`}
            ref={nameRef}
            className="field__control"
            type="text"
            maxLength={MAX_NAME}
            placeholder="City Hall Information Desk"
            value={form.name}
            aria-describedby={error ? errorIds : undefined}
            aria-invalid={error && !form.name.trim() ? 'true' : undefined}
            onChange={setField('name')}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-id`}>
            Site code
          </label>
          <input
            id={`${titleId}-id`}
            className="field__control"
            type="text"
            maxLength={MAX_ID}
            placeholder="CITY_HALL_INFO"
            value={form.id}
            aria-describedby={error ? errorIds : undefined}
            aria-invalid={error && !form.id.trim() ? 'true' : undefined}
            onChange={setField('id')}
          />
          <p className="field__hint">
            Short unique key for this counter, e.g. BCPIO. Letters, numbers,
            underscores and hyphens.
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-address`}>
            Address
          </label>
          <input
            id={`${titleId}-address`}
            className="field__control"
            type="text"
            maxLength={MAX_ADDRESS}
            placeholder="City Hall lobby, Baguio City"
            value={form.address}
            aria-describedby={error ? errorIds : undefined}
            aria-invalid={error && !form.address.trim() ? 'true' : undefined}
            onChange={setField('address')}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-hours`}>
            Counter hours
          </label>
          <input
            id={`${titleId}-hours`}
            className="field__control"
            type="text"
            maxLength={MAX_HOURS}
            placeholder="Mon–Fri, 8:00 AM – 5:00 PM"
            value={form.counterHours}
            aria-describedby={error ? errorIds : undefined}
            aria-invalid={
              error && !form.counterHours.trim() ? 'true' : undefined
            }
            onChange={setField('counterHours')}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-phone`}>
            Contact number <span className="field__optional">Optional</span>
          </label>
          <input
            id={`${titleId}-phone`}
            className="field__control"
            type="tel"
            maxLength={MAX_PHONE}
            placeholder="(074) 442-1111"
            value={form.phoneNumber}
            onChange={setField('phoneNumber')}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-pin`}>
            Map pin <span className="field__optional">Optional</span>
          </label>
          <input
            id={`${titleId}-pin`}
            className="field__control"
            type="text"
            maxLength={MAX_MAP_PIN}
            placeholder="https://maps.app.goo.gl/…"
            value={form.mapPin}
            onChange={setField('mapPin')}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-status`}>
            Status
          </label>
          <select
            id={`${titleId}-status`}
            className="field__control field__control--select"
            value={form.status}
            onChange={setField('status')}
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        <fieldset className="office-dialog__login">
          <legend className="field__label">Shared login</legend>
          <p className="field__hint">
            Everyone at this office signs in with the same credentials.
          </p>
          <div className="field">
            <label className="field__label" htmlFor={`${titleId}-email`}>
              Email
            </label>
            <input
              id={`${titleId}-email`}
              className="field__control"
              type="email"
              maxLength={MAX_EMAIL}
              placeholder="office@baguio.gov.ph"
              value={form.email}
              aria-describedby={error ? errorIds : undefined}
              aria-invalid={error && !form.email.trim() ? 'true' : undefined}
              onChange={setField('email')}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${titleId}-password`}>
              Password
            </label>
            <input
              id={`${titleId}-password`}
              className="field__control"
              type="password"
              minLength={MIN_PASSWORD}
              autoComplete="new-password"
              value={form.password}
              aria-describedby={error ? errorIds : undefined}
              aria-invalid={
                error && form.password.length < MIN_PASSWORD
                  ? 'true'
                  : undefined
              }
              onChange={setField('password')}
            />
            <p className="field__hint">
              At least {MIN_PASSWORD} characters. Share it with the office out
              of band.
            </p>
          </div>
        </fieldset>

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
            type="submit"
            className="btn btn--filled"
            disabled={submitting}
          >
            <Icon name="add" />
            {submitting ? 'Provisioning…' : 'Add office'}
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
      </form>
    </dialog>
  );
}
