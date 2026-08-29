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
  // These are real, visible margins inside the thermal head.  The 4 mm paper
  // gutter is hardware-dependent and must not make an entered 4 mm disappear.
  const contentLeftDots = dotsFromMm(profile.margin_left_mm);
  const contentRightDots = dotsFromMm(profile.margin_right_mm);
  const contentWidthDots = Math.max(1, THERMAL_PRINTABLE_DOTS - contentLeftDots - contentRightDots);
  const configuredWidthDots = dotsFromMm(profile.printable_width_mm);
  // Old tickets stored the previous 80-mm-page interpretation (for example
  // 4 + 72 + 4). Shrink only those historical rows enough to preserve their
  // complete text inside the newly explicit margin area; new tickets already
  // render at the correct width on the backend.
  const historicalScale = Math.min(1, contentWidthDots / configuredWidthDots);
  const fontSizeDots = Math.max(
    1,
    profile.font_size_px * PRINT_DOTS_PER_CSS_PIXEL * historicalScale,
  );
  const lineHeightDots = Math.max(
    Math.ceil(fontSizeDots),
    Math.round(profile.line_height_px * PRINT_DOTS_PER_CSS_PIXEL * historicalScale),
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
function rasterSvg(text: string, profile: TicketPrintProfile, contentOnly: boolean): string {
  const lines = text.replace(/\n$/, '').split('\n');
  const geometry = ticketRasterGeometry(profile, lines.length);
  const fontFamily = escapeXml(ticketFontStack(profile.font_family));
  const fontWeight = profile.font_weight === 'BOLD' ? 700 : 400;
  // The backend formats every line for the configured content width.  The
  // raster must nevertheless enforce that physical boundary: a font fallback
  // or a custom layout must never spill into the right-hand margin (or beyond
  // the thermal head) merely because SVG text is allowed to paint outside its
  // nominal box by default.
  const contentClip = `<defs><clipPath id="ticket-content"><rect x="${geometry.contentLeftDots}" y="0" width="${geometry.contentWidthDots}" height="${geometry.heightDots}"/></clipPath></defs>`;
  const textNodes = lines
    .map((line, index) => {
      const baseline = geometry.topDots + geometry.fontSizeDots + index * geometry.lineHeightDots;
      return `<text x="${geometry.contentLeftDots}" y="${baseline}" xml:space="preserve">${escapeXml(line)}</text>`;
    })
    .join('');

  const imageWidth = contentOnly ? geometry.contentWidthDots : geometry.widthDots;
  const viewBoxX = contentOnly ? geometry.contentLeftDots : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${geometry.heightDots}" viewBox="${viewBoxX} 0 ${imageWidth} ${geometry.heightDots}">${contentClip}<rect width="100%" height="100%" fill="white"/><g clip-path="url(#ticket-content)" fill="black" font-family="${fontFamily}" font-size="${geometry.fontSizeDots}" font-weight="${fontWeight}" font-variant-ligatures="none">${textNodes}</g></svg>`;
}

export function ticketRasterSvg(text: string, profile: TicketPrintProfile): string {
  return rasterSvg(text, profile, false);
}

export function ticketRasterSvgUrl(text: string, profile: TicketPrintProfile): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ticketRasterSvg(text, profile))}`;
}

async function rasterPngUrl(
  text: string,
  profile: TicketPrintProfile,
  contentOnly: boolean,
): Promise<string> {
  await document.fonts?.ready;
  const geometry = ticketRasterGeometry(profile, text.replace(/\n$/, '').split('\n').length);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('No se ha podido rasterizar el ticket.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rasterSvg(text, profile, contentOnly))}`;
  await loaded;

  const canvas = document.createElement('canvas');
  canvas.width = contentOnly ? geometry.contentWidthDots : geometry.widthDots;
  canvas.height = geometry.heightDots;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('El navegador no permite preparar la impresión.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Full 576-dot document used by the on-screen paper preview. */
export function ticketRasterPngUrl(text: string, profile: TicketPrintProfile): Promise<string> {
  return rasterPngUrl(text, profile, false);
}

/**
 * Content-only image used with explicit ESC/POS GS L/GS W print-area commands.
 * This avoids relying on a driver to preserve white columns around a raster.
 */
export function ticketRasterContentPngUrl(
  text: string,
  profile: TicketPrintProfile,
): Promise<string> {
  return rasterPngUrl(text, profile, true);
}
