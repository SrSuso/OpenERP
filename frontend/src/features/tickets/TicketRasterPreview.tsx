import { type TicketPrintProfile } from '@/features/tickets/printProfile';
import {
  THERMAL_HARDWARE_GUTTER_MM,
  THERMAL_PRINTABLE_WIDTH_MM,
  ticketRasterSvgUrl,
} from '@/features/tickets/ticketRaster';

interface TicketRasterPreviewProps {
  text: string;
  profile: TicketPrintProfile;
  compact?: boolean;
}

/** The exact 576-dot image sent to QZ, shown inside the nominal 80 mm roll. */
export function TicketRasterPreview({ text, profile, compact = false }: TicketRasterPreviewProps) {
  return (
    <div
      data-ticket-paper-preview
      className="overflow-hidden border border-slate-300 bg-white shadow-sm"
      style={{ width: '80mm', maxWidth: '100%', boxSizing: 'border-box' }}
    >
      <img
        data-ticket-template-preview
        data-ticket-preview-text={text}
        src={ticketRasterSvgUrl(text, profile)}
        alt="Vista previa exacta del ticket térmico"
        className="block bg-white"
        style={{
          width: `${THERMAL_PRINTABLE_WIDTH_MM}mm`,
          height: 'auto',
          marginLeft: `${THERMAL_HARDWARE_GUTTER_MM}mm`,
          marginRight: `${THERMAL_HARDWARE_GUTTER_MM}mm`,
          maxHeight: compact ? '38rem' : undefined,
          objectFit: compact ? 'contain' : undefined,
          objectPosition: 'top',
        }}
      />
    </div>
  );
}
