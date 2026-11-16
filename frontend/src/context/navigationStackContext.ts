import { createContext, useContext } from "react";

export type OverlayType =
  | "reports"
  | "invoicing"
  | "review"
  | "settings"
  | "period_lock"
  | "account_manager"
  | "upload"
  | "drawer";

export interface OverlayEntry {
  id: string;
  type: OverlayType;
  params?: Record<string, unknown>;
}

export interface NavigationStackContextValue {
  stack: OverlayEntry[];
  current: OverlayEntry | null;
  previous: OverlayEntry | null;
  push: (type: OverlayType, params?: Record<string, unknown>) => void;
  pop: () => void;
  popTo: (id: string) => void;
  closeAll: () => void;
  isOpen: (type: OverlayType) => boolean;
  isSuspended: (type: OverlayType) => boolean;
  isTop: (type: OverlayType) => boolean;
  getParams: <T extends Record<string, unknown> = Record<string, unknown>>(type: OverlayType) => T | undefined;
}

export const NavigationStackContext = createContext<NavigationStackContextValue | null>(null);

export function useNavigationStack(): NavigationStackContextValue {
  const ctx = useContext(NavigationStackContext);
  if (!ctx) {
    return {
      stack: [],
      current: null,
      previous: null,
      push: () => {},
      pop: () => {},
      popTo: () => {},
      closeAll: () => {},
      isOpen: () => false,
      isSuspended: () => false,
      isTop: () => false,
      getParams: () => undefined,
    };
  }
  return ctx;
}
