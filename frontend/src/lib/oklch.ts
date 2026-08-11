/** Un color en el espacio OkLCH: claridad (0-1), saturación y tono. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** `"#22c55e"` → su claridad, saturación y tono. Devuelve `null` si eso no
 * es un color hexadecimal. */
export function hexToOklch(hex: string): Oklch | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;

  const value = match[1]!;
  const r = toLinear(parseInt(value.slice(0, 2), 16) / 255);
  const g = toLinear(parseInt(value.slice(2, 4), 16) / 255);
  const b = toLinear(parseInt(value.slice(4, 6), 16) / 255);

  // sRGB lineal → LMS → OkLab (Björn Ottosson).
  const lms = [
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  ].map(Math.cbrt) as [number, number, number];

  const [l_, m_, s_] = lms;
  const lightness = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return {
    l: lightness,
    c: Math.hypot(a, bb),
    h: hue < 0 ? hue + 360 : hue,
  };
}

export function oklchString({ l, c, h }: Oklch): string {
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
}
