import { useEffect, useRef } from "react";

type Rgba = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

const spotlightRadiusX = 0.62;
const spotlightRadiusY = 0.5;
const ditherStrength = 1.25;
const maxDevicePixelRatio = 2;

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

function devicePixelRatio() {
  const ratio = window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? Math.min(ratio, maxDevicePixelRatio) : 1;
}

function drawSpotlight(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (context === null) {
    return;
  }

  const style = getComputedStyle(document.documentElement);
  const origin = parseColor(style.getPropertyValue("--color-feed-spotlight").trim());
  const endpoint = parseColor(style.getPropertyValue("--color-feed-spotlight-transparent").trim());
  if (origin === null || endpoint === null) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const width = Math.max(1, Math.ceil(window.innerWidth * devicePixelRatio()));
  const height = Math.max(1, Math.ceil(window.innerHeight * devicePixelRatio()));
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
  const radiusX = width * spotlightRadiusX;
  const radiusY = height * spotlightRadiusY;
  const alphaStart = endpoint.alpha;
  const alphaRange = origin.alpha - endpoint.alpha;

  for (let y = 0; y < height; y += 1) {
    const normalizedY = (y + 0.5 - centerY) / radiusY;

    for (let x = 0; x < width; x += 1) {
      const normalizedX = (x + 0.5 - centerX) / radiusX;
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

export function FeedSpotlight() {
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
        drawSpotlight(canvas);
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

  return <canvas aria-hidden="true" className="feed-spotlight-canvas" ref={canvasRef} />;
}
