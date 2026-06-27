import { useEffect, useRef, useState } from "react";

export type RowAction = {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

type RowActionMenuProps = {
  label: string;
  actions: RowAction[];
};

export function RowActionMenu({ label, actions }: RowActionMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      if (ref.current?.contains(event.target as Node) === true) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="row-action-menu" ref={ref}>
      <button
        className="icon-button row-action-menu-button"
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="row-action-menu-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      {open ? (
        <div className="row-action-menu-panel">
          {actions.map((action) => (
            <button
              className={`menu-action-button ${action.danger === true ? "danger" : ""}`}
              disabled={action.disabled}
              key={action.label}
              type="button"
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
