import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CardImage } from './bits';

export interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Room left under the enlarged card for `children`, in px. */
const INFO_SPACE = 150;

/**
 * A large, readable copy of the hovered card, centred in `region` (a part of the screen with no
 * cards in it, such as the board column) so it never covers another card. Mouse only.
 * Rendered into <body> because blurred panels would otherwise trap a fixed-position child.
 */
export function CardMagnifier({ cardId, name, region, overlay, children }: {
  cardId: string;
  name: string;
  region: Region;
  /** Drawn over the card (e.g. status badges). */
  overlay?: ReactNode;
  children?: ReactNode;
}) {
  const width = Math.max(160, Math.min(region.width - 16, ((region.height - (children ? INFO_SPACE : 16)) * 204) / 265));
  return createPortal(
    <div
      className="pointer-events-none fixed z-40 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2"
      style={{ left: region.left + region.width / 2, top: region.top + region.height / 2, width }}
      aria-hidden="true"
    >
      <div className="relative [container-type:inline-size]">
        <CardImage id={cardId} name={name} className="shadow-2xl shadow-black/70 ring-2 ring-white/20" />
        {overlay}
      </div>
      {children && <div className="rounded-lg bg-slate-950/95 p-2 shadow-xl ring-1 ring-white/10">{children}</div>}
    </div>,
    document.body,
  );
}
