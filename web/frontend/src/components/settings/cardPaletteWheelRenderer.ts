import { renderCardPaletteWheelColor } from "../../palette";

const wheelResolution = 112;

export function drawCanonicalCardPaletteWheel(canvas: HTMLCanvasElement) {
  canvas.width = wheelResolution;
  canvas.height = wheelResolution;
  const context = canvas.getContext("2d");
  if (context === null) {
    return;
  }
  context.clearRect(0, 0, wheelResolution, wheelResolution);
  const center = wheelResolution * 0.5;
  const radius = center - 0.5;

  for (let y = 0; y < wheelResolution; y += 1) {
    for (let x = 0; x < wheelResolution; x += 1) {
      const offsetX = x + 0.5 - center;
      const offsetY = y + 0.5 - center;
      const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
      if (distance > radius) {
        continue;
      }
      const hue = ((Math.atan2(offsetY, offsetX) * 180) / Math.PI + 360) % 360;
      context.fillStyle = renderCardPaletteWheelColor({
        colorfulness: (distance / radius) * 100,
        hue,
        mode: "dark",
      });
      context.fillRect(x, y, 1, 1);
    }
  }
}
