export const MOBILE_VISUAL_STATES = [
  "default",
  "pressed",
  "focused",
  "disabled",
  "loading",
  "empty",
  "offline",
  "syncError",
  "conflict",
  "longText",
] as const;

export type MobileVisualState = (typeof MOBILE_VISUAL_STATES)[number];

export interface MobileVisualSignals {
  hasConflict?: boolean;
  hasError: boolean;
  isEmpty: boolean;
  isLoading: boolean;
  isLongText?: boolean;
  isOffline?: boolean;
}

export const mobileVisualFixtures = {
  syncSettings: ["default", "loading", "empty", "offline", "syncError", "longText"],
  taskEditor: ["default", "loading", "empty", "offline", "syncError", "longText"],
  today: ["default", "loading", "empty", "offline", "syncError", "longText"],
} as const satisfies Record<string, readonly MobileVisualState[]>;

export function getMobileVisualState(signals: MobileVisualSignals): MobileVisualState {
  if (signals.isLoading) return "loading";
  if (signals.isOffline) return "offline";
  if (signals.hasError) return "syncError";
  if (signals.hasConflict) return "conflict";
  if (signals.isEmpty) return "empty";
  if (signals.isLongText) return "longText";
  return "default";
}
