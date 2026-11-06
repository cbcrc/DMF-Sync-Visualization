export const STRIP_W = 120;
/** Width of the hatched TOO-LATE box left of the slots, where readers whose grain was overwritten sit. */
export const OVERWRITTEN_W = 26;
/**
 * The optional "Now" marker shows a writer's delay to scale: one strip width
 * (`STRIP_W`) per MXL domain, the same on every strip, so delays compare across
 * functions and tracks. Past `NOW_MAX_DOMAINS` domains the axis is broken (⫽)
 * so long delays (a Profanity Delay) don't make cards huge.
 */
export const NOW_MAX_DOMAINS = 3;
/** Room right of the Now marker for its centred label. */
export const NOW_LABEL_W = 34;
export const CELL_H = 20;
export const LANE_H = 17;
/** Card width: the TOO-LATE box, the slots, and the card's padding. */
export const RING_STRIP_W = STRIP_W + OVERWRITTEN_W + 18;
