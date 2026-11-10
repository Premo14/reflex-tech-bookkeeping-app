/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";

/**
 * DEFAULT_TOOLTIP_DELAY
 * 
 * Duration (in milliseconds) to wait between when the user stops moving their mouse
 * and when the tooltip appears.
 * 
 * Cut way down from the browser native default (~800-1000ms) to 100ms to make
 * hover tooltips feel snappy, immediate, and responsive across the entire application.
 */
export const DEFAULT_TOOLTIP_DELAY = 100;

export type TooltipPosition = "top" | "bottom" | "left" | "right";

interface TooltipState {
  target: HTMLElement;
  text: string;
  position: TooltipPosition;
  delay: number;
}

interface TooltipContextType {
  defaultDelay: number;
  showTooltip: (
    target: HTMLElement,
    text: string,
    position?: TooltipPosition,
    delay?: number
  ) => void;
  hideTooltip: () => void;
}

const TooltipContext = createContext<TooltipContextType | null>(null);

export function useTooltip() {
  const context = useContext(TooltipContext);
  if (!context) {
    throw new Error("useTooltip must be used within a TooltipProvider");
  }
  return context;
}

interface TooltipProviderProps {
  children: React.ReactNode;
  /** App-wide default delay before tooltip appears after stopping mouse movement (in ms) */
  defaultDelay?: number;
}

/**
 * Finds the closest element with tooltip content from a given DOM node.
 * Supports:
 * - `data-tooltip="Tooltip text"`
 * - Native `title="Tooltip text"` (automatically intercepted to prevent slow native OS tooltips)
 * - `data-original-title="Tooltip text"` (while hovered)
 */
function findTooltipElement(node: Node | null): {
  element: HTMLElement;
  text: string;
  position: TooltipPosition;
  delay?: number;
} | null {
  let curr = (node instanceof HTMLElement ? node : node?.parentElement) || null;

  while (curr && curr !== document.body && curr !== document.documentElement) {
    // Check if element has an explicit or intercepted tooltip text
    const text =
      curr.getAttribute("data-tooltip") ||
      curr.getAttribute("title") ||
      curr.getAttribute("data-original-title");

    if (text && text.trim().length > 0) {
      const positionAttr = curr.getAttribute("data-tooltip-position") as TooltipPosition | null;
      const position: TooltipPosition =
        positionAttr === "bottom" ||
        positionAttr === "left" ||
        positionAttr === "right"
          ? positionAttr
          : "top";

      const delayAttr = curr.getAttribute("data-tooltip-delay");
      const delay = delayAttr ? parseInt(delayAttr, 10) : undefined;

      return {
        element: curr,
        text: text.trim(),
        position,
        delay: Number.isFinite(delay) ? delay : undefined,
      };
    }

    curr = curr.parentElement;
  }

  return null;
}

export function TooltipProvider({
  children,
  defaultDelay = DEFAULT_TOOLTIP_DELAY,
}: TooltipProviderProps) {
  const [activeTooltip, setActiveTooltip] = useState<TooltipState | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const activeTargetRef = useRef<HTMLElement | null>(null);
  const pendingTargetRef = useRef<HTMLElement | null>(null);
  const stopMoveTimerRef = useRef<number | null>(null);
  const tooltipDOMRef = useRef<HTMLDivElement | null>(null);
  const recentCloseTimerRef = useRef<number | null>(null);
  const isWarmRef = useRef<boolean>(false);

  const clearTimer = useCallback(() => {
    if (stopMoveTimerRef.current !== null) {
      window.clearTimeout(stopMoveTimerRef.current);
      stopMoveTimerRef.current = null;
    }
  }, []);

  const restoreNativeTitle = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const originalTitle = el.getAttribute("data-original-title");
    if (originalTitle !== null) {
      el.setAttribute("title", originalTitle);
      el.removeAttribute("data-original-title");
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    if (activeTargetRef.current) {
      restoreNativeTitle(activeTargetRef.current);
      activeTargetRef.current = null;
    }
    if (pendingTargetRef.current) {
      restoreNativeTitle(pendingTargetRef.current);
      pendingTargetRef.current = null;
    }
    setActiveTooltip(null);
    setCoords(null);

    // Keep "warm" for 300ms so moving across adjacent tooltips appears quickly
    isWarmRef.current = true;
    if (recentCloseTimerRef.current !== null) {
      window.clearTimeout(recentCloseTimerRef.current);
    }
    recentCloseTimerRef.current = window.setTimeout(() => {
      isWarmRef.current = false;
      recentCloseTimerRef.current = null;
    }, 300);
  }, [clearTimer, restoreNativeTitle]);

  const show = useCallback(
    (
      target: HTMLElement,
      text: string,
      position: TooltipPosition = "top",
      delay: number = defaultDelay
    ) => {
      // Suppress native title to avoid duplicate/slow native browser popup
      if (target.hasAttribute("title")) {
        const titleVal = target.getAttribute("title") || "";
        if (titleVal) {
          target.setAttribute("data-original-title", titleVal);
          if (!target.hasAttribute("aria-label")) {
            target.setAttribute("aria-label", titleVal);
          }
          target.removeAttribute("title");
        }
      }

      activeTargetRef.current = target;
      setActiveTooltip({
        target,
        text,
        position,
        delay,
      });
    },
    [defaultDelay]
  );

  // Position calculation whenever activeTooltip or DOM element updates
  useLayoutEffect(() => {
    if (!activeTooltip || !tooltipDOMRef.current) {
      return;
    }

    const targetRect = activeTooltip.target.getBoundingClientRect();
    const tooltipRect = tooltipDOMRef.current.getBoundingClientRect();
    const gap = 8;
    const margin = 8;

    let top = 0;
    let left = 0;
    const pos = activeTooltip.position;

    if (pos === "top") {
      top = targetRect.top - tooltipRect.height - gap;
      left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
      // If clipped on top, flip to bottom
      if (top < margin) {
        top = targetRect.bottom + gap;
      }
    } else if (pos === "bottom") {
      top = targetRect.bottom + gap;
      left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
      // If clipped on bottom, flip to top
      if (top + tooltipRect.height > window.innerHeight - margin) {
        top = targetRect.top - tooltipRect.height - gap;
      }
    } else if (pos === "left") {
      left = targetRect.left - tooltipRect.width - gap;
      top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
      // If clipped on left, flip to right
      if (left < margin) {
        left = targetRect.right + gap;
      }
    } else if (pos === "right") {
      left = targetRect.right + gap;
      top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
      // If clipped on right, flip to left
      if (left + tooltipRect.width > window.innerWidth - margin) {
        left = targetRect.left - tooltipRect.width - gap;
      }
    }

    // Keep inside viewport bounds
    left = Math.max(margin, Math.min(window.innerWidth - tooltipRect.width - margin, left));
    top = Math.max(margin, Math.min(window.innerHeight - tooltipRect.height - margin, top));

    setCoords({ top, left });
  }, [activeTooltip]);

  // Global mousemove / pointerover listener to handle app-wide tooltips
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      // Ignore non-mouse pointers if needed or touch
      if (e.pointerType === "touch") return;

      const found = findTooltipElement(e.target as Node);

      // If not hovering over any tooltipped element
      if (!found) {
        if (activeTargetRef.current || pendingTargetRef.current) {
          hide();
        }
        return;
      }

      const { element, text, position, delay: explicitDelay } = found;

      // If already displaying for this target, keep it open and do not restart delay
      if (activeTargetRef.current === element) {
        return;
      }

      // If moved to a different element, clean up previous
      if (pendingTargetRef.current && pendingTargetRef.current !== element) {
        restoreNativeTitle(pendingTargetRef.current);
        clearTimer();
      }

      pendingTargetRef.current = element;

      // Temporarily strip native title to prevent native browser tooltip from triggering
      if (element.hasAttribute("title")) {
        const titleVal = element.getAttribute("title") || "";
        if (titleVal) {
          element.setAttribute("data-original-title", titleVal);
          element.removeAttribute("title");
        }
      }

      // Clear any pending stop-move timer
      clearTimer();

      // If warm from a recently closed tooltip, transition with a minimal 40ms delay;
      // otherwise use the configured delay (shortened to default 100ms)
      const targetDelay = isWarmRef.current
        ? 40
        : (explicitDelay ?? defaultDelay);

      stopMoveTimerRef.current = window.setTimeout(() => {
        // User has stopped moving their mouse on this element for the delay duration!
        show(element, text, position, targetDelay);
      }, targetDelay);
    };

    const handlePointerDown = () => {
      // Immediately hide tooltip on click / pointerdown
      hide();
    };

    const handleScroll = () => {
      // Hide on scroll to avoid detached floating tooltips
      hide();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        hide();
      }
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("pointerdown", handlePointerDown, { passive: true });
    document.addEventListener("mouseleave", hide);
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("mouseleave", hide);
      window.removeEventListener("scroll", handleScroll, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
      clearTimer();
    };
  }, [defaultDelay, show, hide, clearTimer, restoreNativeTitle]);

  const contextValue = {
    defaultDelay,
    showTooltip: show,
    hideTooltip: hide,
  };

  return (
    <TooltipContext.Provider value={contextValue}>
      {children}
      {activeTooltip &&
        createPortal(
          <div
            ref={tooltipDOMRef}
            role="tooltip"
            aria-live="polite"
            style={{
              position: "fixed",
              top: coords ? `${coords.top}px` : "-9999px",
              left: coords ? `${coords.left}px` : "-9999px",
              visibility: coords ? "visible" : "hidden",
            }}
            className="z-[99999] pointer-events-none max-w-xs break-words whitespace-pre-line rounded-md bg-zinc-900/95 px-2.5 py-1 text-[11px] font-medium text-zinc-200 shadow-xl border border-white/10 backdrop-blur-md leading-snug animate-in fade-in zoom-in-95 duration-100"
          >
            {activeTooltip.text}
          </div>,
          document.body
        )}
    </TooltipContext.Provider>
  );
}

/**
 * Reusable Tooltip component for wrapping individual JSX elements.
 * 
 * Usage:
 * ```tsx
 * <Tooltip content="This is an app-wide tooltip" position="top" delay={100}>
 *   <button>Hover me</button>
 * </Tooltip>
 * ```
 */
export interface TooltipProps {
  content: string;
  children: React.ReactElement;
  position?: TooltipPosition;
  delay?: number;
  className?: string;
}

export function Tooltip({
  content,
  children,
  position = "top",
  delay = DEFAULT_TOOLTIP_DELAY,
  className = "",
}: TooltipProps) {
  if (!React.isValidElement(children)) {
    return children;
  }

  const childProps = children.props as Record<string, unknown>;

  return React.cloneElement(children, {
    "data-tooltip": content,
    "data-tooltip-position": position,
    "data-tooltip-delay": delay,
    className: `${childProps.className || ""} ${className}`.trim(),
  } as React.HTMLAttributes<HTMLElement>);
}
