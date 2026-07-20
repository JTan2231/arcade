import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

const MENU_GAP = 4;
const MENU_RIGHT_INSET = 6;
const NATIVE_POPOVER_SUPPORTED =
  typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.showPopover === "function";
const VIEWPORT_PADDING = 8;

type MenuPosition = {
  left: number;
  top: number;
};

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
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const menuId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!open || button === null || panel === null) {
      return undefined;
    }

    const openButton = button;
    const openPanel = panel;
    if (NATIVE_POPOVER_SUPPORTED && !openPanel.matches(":popover-open")) {
      openPanel.showPopover();
    }

    let animationFrame: number | null = null;

    function updatePosition() {
      animationFrame = null;
      if (!openButton.isConnected || !openPanel.isConnected) {
        setOpen(false);
        return;
      }

      const nextPosition = menuPosition(openButton.getBoundingClientRect(), openPanel.getBoundingClientRect());
      setPosition((currentPosition) =>
        currentPosition?.left === nextPosition.left && currentPosition.top === nextPosition.top
          ? currentPosition
          : nextPosition,
      );
    }

    function schedulePosition() {
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(updatePosition);
      }
    }

    const resizeObserver = new ResizeObserver(schedulePosition);
    for (let element: HTMLElement | null = openButton; element !== null; element = element.parentElement) {
      resizeObserver.observe(element);
    }
    resizeObserver.observe(openPanel);
    updatePosition();
    document.addEventListener("scroll", schedulePosition, { capture: true, passive: true });
    window.addEventListener("resize", schedulePosition);
    window.visualViewport?.addEventListener("scroll", schedulePosition);
    window.visualViewport?.addEventListener("resize", schedulePosition);

    return () => {
      resizeObserver.disconnect();
      document.removeEventListener("scroll", schedulePosition, { capture: true });
      window.removeEventListener("resize", schedulePosition);
      window.visualViewport?.removeEventListener("scroll", schedulePosition);
      window.visualViewport?.removeEventListener("resize", schedulePosition);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (NATIVE_POPOVER_SUPPORTED && openPanel.isConnected && openPanel.matches(":popover-open")) {
        openPanel.hidePopover();
      }
    };
  }, [open]);

  function toggleMenu() {
    if (open) {
      setOpen(false);
      return;
    }
    buttonRef.current?.focus();
    setPosition(null);
    setOpen(true);
  }

  return (
    <div className={`row-action-menu ${open ? "row-action-menu-open" : ""}`} ref={ref}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        className="icon-button row-action-menu-button"
        ref={buttonRef}
        type="button"
        aria-label={label}
        onClick={toggleMenu}
      >
        <span className="row-action-menu-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      {open ? (
        <div
          className={`row-action-menu-panel ${position === null ? "" : "row-action-menu-panel-positioned"}`}
          id={menuId}
          popover={NATIVE_POPOVER_SUPPORTED ? "manual" : undefined}
          ref={panelRef}
          style={position === null ? undefined : position}
        >
          {actions.map((action) => (
            <button
              className={`menu-action-button ${action.danger === true ? "menu-action-button-danger" : ""}`}
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

function menuPosition(buttonBounds: DOMRect, panelBounds: DOMRect): MenuPosition {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
  const minimumLeft = viewportLeft + VIEWPORT_PADDING;
  const maximumLeft = Math.max(minimumLeft, viewportRight - panelBounds.width - VIEWPORT_PADDING);
  const preferredLeft = buttonBounds.right - panelBounds.width - MENU_RIGHT_INSET;
  const below = buttonBounds.bottom + MENU_GAP;
  const above = buttonBounds.top - panelBounds.height - MENU_GAP;
  const preferredTop =
    below + panelBounds.height <= viewportBottom - VIEWPORT_PADDING || above < viewportTop ? below : above;
  const minimumTop = viewportTop + VIEWPORT_PADDING;
  const maximumTop = Math.max(minimumTop, viewportBottom - panelBounds.height - VIEWPORT_PADDING);

  return {
    left: Math.min(Math.max(preferredLeft, minimumLeft), maximumLeft),
    top: Math.min(Math.max(preferredTop, minimumTop), maximumTop),
  };
}
