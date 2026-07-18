import { useEffect, useId, useRef, type PointerEvent as ReactPointerEvent } from "react";

export type CardPaletteWheelValue = {
  hue: number;
  colorfulness: number;
};

export function CardPaletteWheel({
  label,
  value,
  disabled = false,
  drawWheel,
  onChange,
}: {
  label: string;
  value: CardPaletteWheelValue;
  disabled?: boolean;
  drawWheel: (canvas: HTMLCanvasElement) => void;
  onChange: (value: CardPaletteWheelValue) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hueInputId = useId();
  const colorfulnessInputId = useId();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas !== null) {
      drawWheel(canvas);
    }
  }, [drawWheel]);

  function updateFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const radius = Math.min(bounds.width, bounds.height) * 0.5;
    const x = event.clientX - (bounds.left + bounds.width * 0.5);
    const y = event.clientY - (bounds.top + bounds.height * 0.5);
    const distance = Math.sqrt(x * x + y * y);
    const colorfulness = Math.round(Math.min(1, distance / radius) * 100);
    const hue = distance < 1 ? value.hue : Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
    onChange({ hue: hue === 360 ? 0 : hue, colorfulness });
  }

  const angle = (value.hue * Math.PI) / 180;
  const distance = value.colorfulness * 0.5;
  const handleStyle = {
    left: `${50 + Math.cos(angle) * distance}%`,
    top: `${50 + Math.sin(angle) * distance}%`,
  };

  return (
    <div className="card-palette-wheel-control">
      <div className="card-palette-wheel-label">{label}</div>
      <div
        className={`card-palette-wheel-field ${disabled ? "card-palette-wheel-field-disabled" : ""}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            updateFromPointer(event);
          }
        }}
      >
        <canvas aria-hidden="true" className="card-palette-wheel-canvas" ref={canvasRef} />
        <span aria-hidden="true" className="card-palette-wheel-handle" style={handleStyle} />
      </div>
      <div className="card-palette-wheel-sliders">
        <label aria-label={`${label} hue`} htmlFor={hueInputId}>
          <span className="card-palette-range-label">
            <span>{label} hue</span>
            <output>{value.hue}°</output>
          </span>
          <input
            disabled={disabled}
            id={hueInputId}
            max="359"
            min="0"
            type="range"
            value={value.hue}
            onChange={(event) => onChange({ ...value, hue: Number(event.target.value) })}
          />
        </label>
        <label aria-label={`${label} color intensity`} htmlFor={colorfulnessInputId}>
          <span className="card-palette-range-label">
            <span>{label} color intensity</span>
            <output>{value.colorfulness}%</output>
          </span>
          <input
            disabled={disabled}
            id={colorfulnessInputId}
            max="100"
            min="0"
            type="range"
            value={value.colorfulness}
            onChange={(event) => onChange({ ...value, colorfulness: Number(event.target.value) })}
          />
        </label>
      </div>
    </div>
  );
}
