import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';

/*
 * Central admin row actions for the offices table (US-03).
 *
 * A kebab button opens a small menu. The menu is fixed-positioned from the
 * button's rect so the table's horizontal scroll container cannot clip it, and
 * it closes on scroll or resize rather than drift away from its row.
 *
 * Reset is offered only once the office has a login; before that it stays in
 * the menu, disabled, with the reason beside it.
 */
export default function OfficeActionsMenu({ office, onReset }) {
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [position, setPosition] = useState(null); // null while closed
  const menuId = useId();

  const open = position !== null;
  const hasLogin = Boolean(office.auth_user_id);
  const label = `Actions for ${office.name}`;

  useEffect(() => {
    if (!open) return undefined;

    menuRef.current
      ?.querySelector('[role="menuitem"]')
      ?.focus({ preventScroll: true });

    function close() {
      setPosition(null);
    }

    function handlePointerDown(event) {
      if (
        menuRef.current?.contains(event.target) ||
        buttonRef.current?.contains(event.target)
      ) {
        return;
      }
      close();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setPosition(null);
      return;
    }
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({
      top: rect.bottom,
      right: document.documentElement.clientWidth - rect.right,
    });
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setPosition(null);
      buttonRef.current?.focus();
    } else if (event.key === 'Tab') {
      setPosition(null);
    }
  }

  function handleReset() {
    if (!hasLogin) return;
    setPosition(null);
    // Focus the trigger first so the dialog hands focus back here on close,
    // rather than to a menu item that no longer exists.
    buttonRef.current?.focus();
    onReset(office);
  }

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        <Icon name="more_horiz" />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="office-menu"
          style={{ top: position.top, right: position.right }}
          onKeyDown={handleKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="office-menu__item"
            aria-disabled={hasLogin ? undefined : 'true'}
            onClick={handleReset}
          >
            <Icon name="lock_reset" />
            <span className="office-menu__label">
              Reset password
              {!hasLogin && (
                <span className="office-menu__hint">No login yet</span>
              )}
            </span>
          </button>
        </div>
      )}
    </>
  );
}
