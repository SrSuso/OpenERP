import {
  THERMAL_PAPER_WIDTH_MM,
  ticketFontStack,
  type TicketPrintProfile,
} from '@/features/tickets/printProfile';

/** Native characteristics advertised by the POS-80: 576 dots on 80 mm paper. */
export const THERMAL_PRINTER_DPI = 203;
export const THERMAL_PRINTABLE_DOTS = 576;
export const THERMAL_PRINTABLE_WIDTH_MM = 72;
export const THERMAL_HARDWARE_GUTTER_MM = (THERMAL_PAPER_WIDTH_MM - THERMAL_PRINTABLE_WIDTH_MM) / 2;

const DOTS_PER_MM = THERMAL_PRINTER_DPI / 25.4;
const PRINT_DOTS_PER_CSS_PIXEL = THERMAL_PRINTER_DPI / 96;

export interface TicketRasterGeometry {
  widthDots: number;
  heightDots: number;
  contentLeftDots: number;
  contentWidthDots: number;
  fontSizeDots: number;
  lineHeightDots: number;
  topDots: number;
  bottomDots: number;
}

function dotsFromMm(value: number): number {
  return Math.max(0, Math.round(value * DOTS_PER_MM));
}

export function ticketRasterGeometry(
  profile: TicketPrintProfile,
  lineCount: number,
): TicketRasterGeometry {
  // The head already starts 4 mm inside an 80 mm roll. Template margins are
  // absolute paper margins, so only their part beyond that hardware gutter is
  // encoded as blank raster pixels.
  const contentLeftDots = dotsFromMm(
    Math.max(0, profile.margin_left_mm - THERMAL_HARDWARE_GUTTER_MM),
  );
  const contentRightDots = dotsFromMm(
    Math.max(0, profile.margin_right_mm - THERMAL_HARDWARE_GUTTER_MM),
  );
  const contentWidthDots = Math.max(1, THERMAL_PRINTABLE_DOTS - contentLeftDots - contentRightDots);
  const fontSizeDots = Math.max(1, profile.font_size_px * PRINT_DOTS_PER_CSS_PIXEL);
  const lineHeightDots = Math.max(
    Math.ceil(fontSizeDots),
    Math.round(profile.line_height_px * PRINT_DOTS_PER_CSS_PIXEL),
  );
  const topDots = dotsFromMm(profile.margin_top_mm);
  const bottomDots = dotsFromMm(profile.margin_bottom_mm);
  const heightDots = Math.max(1, topDots + Math.max(1, lineCount) * lineHeightDots + bottomDots);

  return {
    widthDots: THERMAL_PRINTABLE_DOTS,
    heightDots,
    contentLeftDots,
    contentWidthDots,
    fontSizeDots,
    lineHeightDots,
    topDots,
    bottomDots,
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * One deterministic document for both preview and printing. It is deliberately
 * raster-sized in printer dots instead of CSS millimetres, so Windows cannot
 * recompute its margins, font metrics or centring.
 */
export function ticketRasterSvg(text: string, profile: TicketPrintProfile): string {
  const lines = text.replace(/\n$/, '').split('\n');
  const geometry = ticketRasterGeometry(profile, lines.length);
  const fontFamily = escapeXml(ticketFontStack(profile.font_family));
  const fontWeight = profile.font_weight === 'BOLD' ? 700 : 400;
  const textNodes = lines
    .map((line, index) => {
      const baseline = geometry.topDots + geometry.fontSizeDots + index * geometry.lineHeightDots;
      return `<text x="${geometry.contentLeftDots}" y="${baseline}" xml:space="preserve">${escapeXml(line)}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.widthDots}" height="${geometry.heightDots}" viewBox="0 0 ${geometry.widthDots} ${geometry.heightDots}"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="${fontFamily}" font-size="${geometry.fontSizeDots}" font-weight="${fontWeight}" font-variant-ligatures="none">${textNodes}</g></svg>`;
}

export function ticketRasterSvgUrl(text: string, profile: TicketPrintProfile): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ticketRasterSvg(text, profile))}`;
}

export async function ticketRasterPngUrl(
  text: string,
  profile: TicketPrintProfile,
): Promise<string> {
  await document.fonts?.ready;
  const geometry = ticketRasterGeometry(profile, text.replace(/\n$/, '').split('\n').length);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('No se ha podido rasterizar el ticket.'));
  });
  image.src = ticketRasterSvgUrl(text, profile);
  await loaded;

  const canvas = document.createElement('canvas');
  canvas.width = geometry.widthDots;
  canvas.height = geometry.heightDots;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('El navegador no permite preparar la impresión.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}
