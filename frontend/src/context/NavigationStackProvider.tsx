import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  type OverlayType,
  type OverlayEntry,
  type NavigationStackContextValue,
  NavigationStackContext,
} from "./navigationStackContext";

export function NavigationStackProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<OverlayEntry[]>([]);
  const nextIdRef = useRef(1);

  const push = useCallback((type: OverlayType, params?: Record<string, unknown>) => {
    setStack((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.type === type && JSON.stringify(top.params) === JSON.stringify(params)) {
        return prev;
      }
      const newEntry: OverlayEntry = {
        id: `${type}-${nextIdRef.current++}`,
        type,
        params,
      };
      return [...prev, newEntry];
    });
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, prev.length - 1);
    });
  }, []);

  const popTo = useCallback((id: string) => {
    setStack((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      if (idx === -1) return prev;
      return prev.slice(0, idx + 1);
    });
  }, []);

  const closeAll = useCallback(() => {
    setStack([]);
  }, []);

  const isOpen = useCallback(
    (type: OverlayType) => {
      return stack.some((entry) => entry.type === type);
    },
    [stack]
  );

  const isSuspended = useCallback(
    (type: OverlayType) => {
      const top = stack[stack.length - 1];
      return top?.type !== type && stack.some((entry) => entry.type === type);
    },
    [stack]
  );

  const isTop = useCallback(
    (type: OverlayType) => {
      const top = stack[stack.length - 1];
      return top?.type === type;
    },
    [stack]
  );

  const getParams = useCallback(
    <T extends Record<string, unknown> = Record<string, unknown>>(type: OverlayType): T | undefined => {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].type === type) {
          return stack[i].params as T | undefined;
        }
      }
      return undefined;
    },
    [stack]
  );

  const current = stack.length > 0 ? stack[stack.length - 1] : null;
  const previous = stack.length > 1 ? stack[stack.length - 2] : null;

  useEffect(() => {
    const handleGlobalEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack.length > 0) {
        // Fallback if needed
      }
    };
    window.addEventListener("keydown", handleGlobalEsc);
    return () => window.removeEventListener("keydown", handleGlobalEsc);
  }, [stack.length]);

  const value = useMemo<NavigationStackContextValue>(
    () => ({
      stack,
      current,
      previous,
      push,
      pop,
      popTo,
      closeAll,
      isOpen,
      isSuspended,
      isTop,
      getParams,
    }),
    [stack, current, previous, push, pop, popTo, closeAll, isOpen, isSuspended, isTop, getParams]
  );

  return <NavigationStackContext.Provider value={value}>{children}</NavigationStackContext.Provider>;
}
