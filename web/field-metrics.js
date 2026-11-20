// Normalized coordinates of the editor's eleven-player diagram. Positive
// route depth is measured upfield from the line of scrimmage.
export const SCRIMMAGE_Y = 67;
export const UNITS_PER_YARD_Y = 2;
export const routeDepthYards = y => (SCRIMMAGE_Y - y) / UNITS_PER_YARD_Y;
