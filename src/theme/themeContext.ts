import { createContext } from "react";

export type ThemeId = "technical-calm" | "light" | "high-contrast";

export interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
