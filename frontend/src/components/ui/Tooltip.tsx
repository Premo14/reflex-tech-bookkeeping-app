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
 * Cut down from browser native default (~800-1000ms) to 100ms to make
 * hover tooltips feel snappy, immediate, and responsive across the entire application.
 */
export const DEFAULT_TOOLTIP_DELAY = 100;

export type TooltipPosition = "top" | "bottom" | "left" | "right";

export interface TooltipCoords {
  top: number;
  left: number;
}

interface TooltipState {
  target: HTMLElement;
  text: string;
  position: TooltipPosition;
  delay: number;
  coords: TooltipCoords;
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

// Singleton measuring element attached to document.body once
let measureEl: HTMLDivElement | null = null;

function getTooltipDimensions(text: string): { width: number; height: number } {
  if (typeof document === "undefined") {
    return { width: 120, height: 32 };
  }
  if (!measureEl) {
    measureEl = document.createElement("div");
    measureEl.setAttribute("aria-hidden", "true");
    measureEl.className =
      "pointer-events-none fixed top-0 left-0 -translate-x-[99999px] -translate-y-[99999px] invisible max-w-xs break-words whitespace-pre-line rounded-md px-2.5 py-1 text-[11px] font-medium leading-snug border border-white/10";
    document.body.appendChild(measureEl);
  }
  measureEl.textContent = text;
  const rect = measureEl.getBoundingClientRect();
  return {
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
  };
}

function calculateCoords(
  targetRect: DOMRect,
  width: number,
  height: number,
  preferredPosition: TooltipPosition = "top"
): { coords: TooltipCoords; actualPosition: TooltipPosition } {
  const gap = 8;
  const margin = 8;

  let top = 0;
  let left = 0;
  let actualPosition = preferredPosition;

  if (preferredPosition === "top") {
    top = targetRect.top - height - gap;
    left = targetRect.left + (targetRect.width - width) / 2;
    // If clipped on top, flip to bottom
    if (top < margin) {
      top = targetRect.bottom + gap;
      actualPosition = "bottom";
    }
  } else if (preferredPosition === "bottom") {
    top = targetRect.bottom + gap;
    left = targetRect.left + (targetRect.width - width) / 2;
    // If clipped on bottom, flip to top
    if (top + height > window.innerHeight - margin) {
      top = targetRect.top - height - gap;
      actualPosition = "top";
    }
  } else if (preferredPosition === "left") {
    left = targetRect.left - width - gap;
    top = targetRect.top + (targetRect.height - height) / 2;
    // If clipped on left, flip to right
    if (left < margin) {
      left = targetRect.right + gap;
      actualPosition = "right";
    }
  } else if (preferredPosition === "right") {
    left = targetRect.right + gap;
    top = targetRect.top + (targetRect.height - height) / 2;
    // If clipped on right, flip to left
    if (left + width > window.innerWidth - margin) {
      left = targetRect.left - width - gap;
      actualPosition = "left";
    }
  }

  // Keep inside viewport bounds
  left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
  top = Math.max(margin, Math.min(window.innerHeight - height - margin, top));

  return { coords: { top, left }, actualPosition };
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
        element: curr as HTMLElement,
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

      // Compute exact position immediately before rendering so tooltip never renders at (0,0) or off-screen
      const targetRect = target.getBoundingClientRect();
      const { width, height } = getTooltipDimensions(text);
      const { coords, actualPosition } = calculateCoords(targetRect, width, height, position);

      activeTargetRef.current = target;
      setActiveTooltip({
        target,
        text,
        position: actualPosition,
        delay,
        coords,
      });
    },
    [defaultDelay]
  );

  // Position refinement after mount in case of any slight subpixel differences
  useLayoutEffect(() => {
    if (!activeTooltip || !tooltipDOMRef.current) {
      return;
    }

    const targetRect = activeTooltip.target.getBoundingClientRect();
    const tooltipRect = tooltipDOMRef.current.getBoundingClientRect();
    const { coords: refinedCoords, actualPosition } = calculateCoords(
      targetRect,
      tooltipRect.width,
      tooltipRect.height,
      activeTooltip.position
    );

    // Only update state if discrepancy is greater than 0.5px or position flipped
    if (
      Math.abs(refinedCoords.top - activeTooltip.coords.top) > 0.5 ||
      Math.abs(refinedCoords.left - activeTooltip.coords.left) > 0.5 ||
      actualPosition !== activeTooltip.position
    ) {
      setActiveTooltip((prev) =>
        prev
          ? {
              ...prev,
              position: actualPosition,
              coords: refinedCoords,
            }
          : null
      );
    }
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

      // If moved to a different element, clean up previous pending element
      if (pendingTargetRef.current && pendingTargetRef.current !== element) {
        restoreNativeTitle(pendingTargetRef.current);
        clearTimer();
      }

      // If we are switching to another element while a tooltip is already active, dismiss old tooltip
      if (activeTargetRef.current && activeTargetRef.current !== element) {
        restoreNativeTitle(activeTargetRef.current);
        activeTargetRef.current = null;
        setActiveTooltip(null);
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
      // otherwise use the configured delay (default 100ms)
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

    const handleResize = () => {
      // Hide on window resize to avoid stale coordinates
      hide();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        hide();
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      const found = findTooltipElement(e.target as Node);
      if (found) {
        clearTimer();
        pendingTargetRef.current = found.element;
        show(found.element, found.text, found.position, 0);
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      if (activeTargetRef.current && e.target === activeTargetRef.current) {
        hide();
      }
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("pointerdown", handlePointerDown, { passive: true });
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("mouseleave", hide);
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("beforeprint", hide);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("mouseleave", hide);
      window.removeEventListener("scroll", handleScroll, { capture: true });
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("beforeprint", hide);
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
            key={`${activeTooltip.text}-${Math.round(activeTooltip.coords.top)}-${Math.round(activeTooltip.coords.left)}`}
            ref={tooltipDOMRef}
            role="tooltip"
            aria-live="polite"
            style={{
              position: "fixed",
              top: `${activeTooltip.coords.top}px`,
              left: `${activeTooltip.coords.left}px`,
              transformOrigin:
                activeTooltip.position === "top"
                  ? "center bottom"
                  : activeTooltip.position === "bottom"
                  ? "center top"
                  : activeTooltip.position === "left"
                  ? "right center"
                  : "left center",
              transition: "none",
            }}
            className="z-[99999] pointer-events-none max-w-xs break-words whitespace-pre-line rounded-md bg-zinc-900/95 px-2.5 py-1 text-[11px] font-medium text-zinc-200 shadow-xl border border-white/10 backdrop-blur-md leading-snug animate-tooltip-in transition-none print:hidden"
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
