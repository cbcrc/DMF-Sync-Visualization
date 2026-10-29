export const STRIP_W = 120;
/** Width of the hatched "overwritten" zone left of the slots, where too-late readers land. */
export const OVERWRITTEN_W = 24;
/** Extra room right of the write head for the optional "now" marker. */
export const NOW_W = 48;
export const CELL_H = 18;
export const LANE_H = 17;
/** Card width: the slots, the overwritten zone, and the card's padding. */
export const RING_STRIP_W = STRIP_W + OVERWRITTEN_W + 18;
