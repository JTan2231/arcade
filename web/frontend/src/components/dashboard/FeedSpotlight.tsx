import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { FeedSpotlightContext, type FeedSpotlightTone } from "./feedSpotlightContext";

type Rgba = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

type SpotlightTarget = {
  active: boolean;
  element: HTMLElement;
  id: string;
  order: number;
  tone: FeedSpotlightTone;
};

const ambientSpotlightRadiusX = 0.62;
const ambientSpotlightRadiusY = 0.5;
const focusSpotlightWidthRatio = 1.16;
const focusSpotlightHeightRatio = 0.82;
const minimumFocusSpotlightWidth = 440;
const minimumFocusSpotlightHeight = 420;
const focusedFeedSpotlightIntensity = 1.6;
const ditherStrength = 1.25;
const maxAmbientDevicePixelRatio = 2;
const maxPostDevicePixelRatio = 1.25;
const spotlightExitRetention = 1_300;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hashUnit(x: number, y: number) {
  let value = Math.imul(x ^ Math.imul(y, 374761393), 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (((value ^ (value >>> 16)) >>> 0) + 0.5) / 4294967296;
}

function ditherChannel(value: number, x: number, y: number) {
  const jitter = (hashUnit(x, y) - 0.5) * ditherStrength;
  return Math.round(clamp(value + jitter, 0, 255));
}

function parseColor(color: string): Rgba | null {
  if (color === "") {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    return null;
  }

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);

  const pixel = context.getImageData(0, 0, 1, 1).data;
  return {
    red: pixel[0] ?? 0,
    green: pixel[1] ?? 0,
    blue: pixel[2] ?? 0,
    alpha: pixel[3] ?? 0,
  };
}

function devicePixelRatio(maximum: number) {
  const ratio = window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? Math.min(ratio, maximum) : 1;
}

function drawSpotlight({
  canvas,
  cssWidth,
  cssHeight,
  originToken,
  endpointToken,
  radiusX,
  radiusY,
  maximumDevicePixelRatio,
  intensity = 1,
}: {
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
  originToken: string;
  endpointToken: string;
  radiusX: number;
  radiusY: number;
  maximumDevicePixelRatio: number;
  intensity?: number;
}) {
  const context = canvas.getContext("2d");
  if (context === null) {
    return;
  }

  const style = getComputedStyle(document.documentElement);
  const origin = parseColor(style.getPropertyValue(originToken).trim());
  const endpoint = parseColor(style.getPropertyValue(endpointToken).trim());
  if (origin === null || endpoint === null) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const ratio = devicePixelRatio(maximumDevicePixelRatio);
  const width = Math.max(1, Math.ceil(cssWidth * ratio));
  const height = Math.max(1, Math.ceil(cssHeight * ratio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }

  const image = context.createImageData(width, height);
  const pixels = image.data;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const pixelRadiusX = width * radiusX;
  const pixelRadiusY = height * radiusY;
  const alphaStart = clamp(endpoint.alpha * intensity, 0, 255);
  const alphaEnd = clamp(origin.alpha * intensity, 0, 255);
  const alphaRange = alphaEnd - alphaStart;

  for (let y = 0; y < height; y += 1) {
    const normalizedY = (y + 0.5 - centerY) / pixelRadiusY;

    for (let x = 0; x < width; x += 1) {
      const normalizedX = (x + 0.5 - centerX) / pixelRadiusX;
      const distance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
      const field = clamp(1 - distance, 0, 1);
      const alpha = alphaStart + alphaRange * field;
      const index = (y * width + x) * 4;

      pixels[index] = origin.red;
      pixels[index + 1] = origin.green;
      pixels[index + 2] = origin.blue;
      pixels[index + 3] = ditherChannel(alpha, x, y);
    }
  }

  context.putImageData(image, 0, 0);
}

function AmbientSpotlight() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    let animationFrame: number | null = null;

    const scheduleDraw = () => {
      if (animationFrame !== null) {
        return;
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        drawSpotlight({
          canvas,
          cssWidth: window.innerWidth,
          cssHeight: window.innerHeight,
          originToken: "--color-feed-spotlight",
          endpointToken: "--color-feed-spotlight-transparent",
          radiusX: ambientSpotlightRadiusX,
          radiusY: ambientSpotlightRadiusY,
          maximumDevicePixelRatio: maxAmbientDevicePixelRatio,
        });
      });
    };

    scheduleDraw();
    window.addEventListener("resize", scheduleDraw);

    const visualViewport = window.visualViewport;
    if (visualViewport !== null && visualViewport !== undefined) {
      visualViewport.addEventListener("resize", scheduleDraw);
    }

    return () => {
      window.removeEventListener("resize", scheduleDraw);
      if (visualViewport !== null && visualViewport !== undefined) {
        visualViewport.removeEventListener("resize", scheduleDraw);
      }
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  return <canvas aria-hidden="true" className="feed-spotlight-canvas feed-spotlight-ambient-canvas" ref={canvasRef} />;
}

function FocusedSpotlight({ target, tone }: { target: SpotlightTarget | null; tone: FeedSpotlightTone }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layerSizeRef = useRef({ height: 1, width: 1 });
  const [positioned, setPositioned] = useState(false);
  const feedTone = tone === "feed";
  const originToken = feedTone ? "--color-feed-spotlight" : "--color-post-spotlight";
  const endpointToken = feedTone ? "--color-feed-spotlight-transparent" : "--color-post-spotlight-transparent";
  const intensity = feedTone ? focusedFeedSpotlightIntensity : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const draw = () => {
      const width = Math.max(minimumFocusSpotlightWidth, window.innerWidth * focusSpotlightWidthRatio);
      const height = Math.max(minimumFocusSpotlightHeight, window.innerHeight * focusSpotlightHeightRatio);
      layerSizeRef.current = { height, width };
      drawSpotlight({
        canvas,
        cssWidth: width,
        cssHeight: height,
        originToken,
        endpointToken,
        radiusX: 0.5,
        radiusY: 0.5,
        maximumDevicePixelRatio: maxPostDevicePixelRatio,
        intensity,
      });
    };

    draw();
    window.addEventListener("resize", draw);

    const visualViewport = window.visualViewport;
    if (visualViewport !== null && visualViewport !== undefined) {
      visualViewport.addEventListener("resize", draw);
    }

    return () => {
      window.removeEventListener("resize", draw);
      if (visualViewport !== null && visualViewport !== undefined) {
        visualViewport.removeEventListener("resize", draw);
      }
    };
  }, [endpointToken, intensity, originToken]);

  const targetElement = target?.element ?? null;
  const targetActive = target?.active === true;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || targetElement === null) {
      setPositioned(false);
      return;
    }
    if (!targetActive) {
      // Leave the canvas at its last active position while it fades instead of
      // following a target whose bounds are collapsing underneath it.
      return;
    }

    let animationFrame: number | null = null;

    const updatePosition = () => {
      animationFrame = null;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const bounds = targetElement.getBoundingClientRect();
      const visibleLeft = Math.max(0, bounds.left);
      const visibleRight = Math.min(viewportWidth, bounds.right);
      const visibleTop = Math.max(0, bounds.top);
      const visibleBottom = Math.min(viewportHeight, bounds.bottom);
      const visible =
        targetElement.isConnected && visibleRight > visibleLeft && visibleBottom > visibleTop && bounds.width > 0;

      if (!visible) {
        setPositioned(false);
        return;
      }

      const centerX = (visibleLeft + visibleRight) * 0.5;
      const centerY = visibleTop + (visibleBottom - visibleTop) * 0.38;
      const { height, width } = layerSizeRef.current;
      canvas.style.transform = `translate3d(${centerX - width * 0.5}px, ${centerY - height * 0.5}px, 0)`;
      setPositioned(true);
    };

    const schedulePosition = () => {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame(updatePosition);
    };

    const layoutObserver = new ResizeObserver(schedulePosition);
    for (let element: HTMLElement | null = targetElement; element !== null; element = element.parentElement) {
      layoutObserver.observe(element);
    }
    updatePosition();
    window.addEventListener("scroll", schedulePosition, { passive: true });
    window.addEventListener("resize", schedulePosition);

    const visualViewport = window.visualViewport;
    if (visualViewport !== null && visualViewport !== undefined) {
      visualViewport.addEventListener("scroll", schedulePosition);
      visualViewport.addEventListener("resize", schedulePosition);
    }

    return () => {
      layoutObserver.disconnect();
      window.removeEventListener("scroll", schedulePosition);
      window.removeEventListener("resize", schedulePosition);
      if (visualViewport !== null && visualViewport !== undefined) {
        visualViewport.removeEventListener("scroll", schedulePosition);
        visualViewport.removeEventListener("resize", schedulePosition);
      }
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [targetActive, targetElement]);

  const visible = targetActive && positioned;
  const className = [
    "feed-spotlight-canvas",
    "feed-spotlight-focus-canvas",
    visible ? "feed-spotlight-focus-canvas-visible" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return <canvas aria-hidden="true" className={className} ref={canvasRef} />;
}

export function FeedSpotlight({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<ReadonlyMap<string, SpotlightTarget>>(() => new Map());
  const removalTimers = useRef(new Map<string, number>());
  const nextTargetOrder = useRef(0);

  const registerTarget = useCallback((id: string, element: HTMLElement, tone: FeedSpotlightTone) => {
    const timer = removalTimers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      removalTimers.current.delete(id);
    }

    setTargets((current) => {
      const existing = current.get(id);
      if (existing?.active === true && existing.element === element && existing.tone === tone) {
        return current;
      }
      nextTargetOrder.current += 1;
      const next = new Map(current);
      next.set(id, { active: true, element, id, order: nextTargetOrder.current, tone });
      return next;
    });
  }, []);

  const releaseTarget = useCallback((id: string, element: HTMLElement) => {
    setTargets((current) => {
      const existing = current.get(id);
      if (existing === undefined || existing.element !== element || !existing.active) {
        return current;
      }
      const next = new Map(current);
      next.set(id, { ...existing, active: false });
      return next;
    });

    const existingTimer = removalTimers.current.get(id);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
      removalTimers.current.delete(id);
      setTargets((current) => {
        const existing = current.get(id);
        if (existing === undefined || existing.element !== element || existing.active) {
          return current;
        }
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    }, spotlightExitRetention);
    removalTimers.current.set(id, timer);
  }, []);

  useEffect(
    () => () => {
      for (const timer of removalTimers.current.values()) {
        window.clearTimeout(timer);
      }
      removalTimers.current.clear();
    },
    [],
  );

  const context = useMemo(() => ({ registerTarget, releaseTarget }), [registerTarget, releaseTarget]);
  const orderedTargets = [...targets.values()].sort((left, right) => right.order - left.order);
  const presentedTarget = orderedTargets.find((target) => target.active) ?? orderedTargets[0] ?? null;
  const feedTarget = presentedTarget?.tone === "feed" ? presentedTarget : null;
  const postTarget = presentedTarget?.tone === "post" ? presentedTarget : null;

  return (
    <FeedSpotlightContext.Provider value={context}>
      <AmbientSpotlight />
      <FocusedSpotlight target={postTarget} tone="post" />
      <FocusedSpotlight target={feedTarget} tone="feed" />
      {children}
    </FeedSpotlightContext.Provider>
  );
}
