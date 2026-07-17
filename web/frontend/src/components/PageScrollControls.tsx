import { useLayoutEffect, useState } from "react";

type PageScrollState = {
  canScrollDown: boolean;
  canScrollUp: boolean;
  scrollable: boolean;
};

const EDGE_TOLERANCE = 2;
const PAGE_STEP_RATIO = 0.8;
const INITIAL_SCROLL_STATE: PageScrollState = {
  canScrollDown: false,
  canScrollUp: false,
  scrollable: false,
};

export function PageScrollControls({ contentRoot }: { contentRoot: HTMLElement }) {
  const [scrollState, setScrollState] = useState<PageScrollState>(INITIAL_SCROLL_STATE);

  useLayoutEffect(() => {
    let animationFrame: number | null = null;

    function measureScrollState() {
      animationFrame = null;
      const scrollingElement = document.scrollingElement ?? document.documentElement;

      const maximumScrollTop = Math.max(0, scrollingElement.scrollHeight - scrollingElement.clientHeight);
      const nextState = {
        canScrollDown: maximumScrollTop - scrollingElement.scrollTop > EDGE_TOLERANCE,
        canScrollUp: scrollingElement.scrollTop > EDGE_TOLERANCE,
        scrollable: maximumScrollTop > EDGE_TOLERANCE,
      };
      setScrollState((currentState) =>
        currentState.canScrollDown === nextState.canScrollDown &&
        currentState.canScrollUp === nextState.canScrollUp &&
        currentState.scrollable === nextState.scrollable
          ? currentState
          : nextState,
      );
    }

    function scheduleMeasurement() {
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(measureScrollState);
      }
    }

    const resizeObserver = new ResizeObserver(scheduleMeasurement);
    const visualViewport = window.visualViewport;
    resizeObserver.observe(contentRoot);
    measureScrollState();
    window.addEventListener("scroll", scheduleMeasurement, { passive: true });
    window.addEventListener("resize", scheduleMeasurement);
    visualViewport?.addEventListener("scroll", scheduleMeasurement);
    visualViewport?.addEventListener("resize", scheduleMeasurement);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", scheduleMeasurement);
      window.removeEventListener("resize", scheduleMeasurement);
      visualViewport?.removeEventListener("scroll", scheduleMeasurement);
      visualViewport?.removeEventListener("resize", scheduleMeasurement);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [contentRoot]);

  function scrollPage(direction: -1 | 1) {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({
      behavior: reducedMotion ? "auto" : "smooth",
      top: direction * viewportHeight * PAGE_STEP_RATIO,
    });
  }

  if (!scrollState.scrollable) {
    return null;
  }

  return (
    <div className="page-scroll-controls" role="group" aria-label="Page scrolling">
      <button
        aria-label="Scroll up"
        className="page-scroll-button"
        title="Scroll up"
        type="button"
        disabled={!scrollState.canScrollUp}
        onClick={() => scrollPage(-1)}
      >
        <PageScrollIcon direction="up" />
      </button>
      <button
        aria-label="Scroll down"
        className="page-scroll-button"
        title="Scroll down"
        type="button"
        disabled={!scrollState.canScrollDown}
        onClick={() => scrollPage(1)}
      >
        <PageScrollIcon direction="down" />
      </button>
    </div>
  );
}

function PageScrollIcon({ direction }: { direction: "down" | "up" }) {
  return (
    <svg
      aria-hidden="true"
      className="page-scroll-icon"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d={direction === "up" ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
    </svg>
  );
}
