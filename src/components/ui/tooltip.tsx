import {
  type Component,
  type JSX,
  createSignal,
  onMount,
  splitProps,
} from "solid-js";
import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip";
import { clsx } from "clsx";

export interface TooltipProps {
  content: JSX.Element | string;
  children: JSX.Element;
  placement?:
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "top-start"
    | "top-end"
    | "bottom-start"
    | "bottom-end";
  openDelay?: number;
  closeDelay?: number;
  disabled?: boolean;
  class?: string;
  contentClass?: string;
}

/**
 * Calculates the best tooltip placement based on trigger element coordinates
 * relative to screen size (from 300px mobile to tablet to desktop).
 */
export function calculateOptimalPlacement(
  rect?: DOMRect | null,
  fallback: TooltipProps["placement"] = "top"
): TooltipProps["placement"] {
  if (!rect || typeof window === "undefined") {
    return fallback;
  }

  const winWidth = window.innerWidth;
  const winHeight = window.innerHeight;

  // Ultra-compact / mobile viewports (e.g. 300px width or 400px height)
  const isCompactMobile = winWidth <= 380 || winHeight <= 450;
  const isTablet = winWidth > 380 && winWidth <= 768;

  // Distance from edges
  const distTop = rect.top;
  const distBottom = winHeight - rect.bottom;
  const distLeft = rect.left;
  const distRight = winWidth - rect.right;

  // If very close to top titlebar (e.g. <= 60px), must go bottom
  if (distTop < 60) {
    if (distRight < 70) return "bottom-end";
    if (distLeft < 70) return "bottom-start";
    return "bottom";
  }

  // If very close to window bottom (<= 60px), must go top
  if (distBottom < 60) {
    if (distRight < 70) return "top-end";
    if (distLeft < 70) return "top-start";
    return "top";
  }

  if (isCompactMobile) {
    // On 300px mobile, prefer top or bottom with horizontal alignment to prevent edge clipping
    const vertical = distTop > distBottom ? "top" : "bottom";
    if (distRight < 60) return `${vertical}-end` as TooltipProps["placement"];
    if (distLeft < 60) return `${vertical}-start` as TooltipProps["placement"];
    return vertical;
  }

  if (isTablet) {
    if (distTop > 80 && distBottom < 80) return "top";
    if (distBottom > 80 && distTop < 80) return "bottom";
  }

  // Desktop: check lateral positions if triggered from side icons
  if (distRight < 120 && distLeft > 120 && distTop > 50 && distBottom > 50) {
    return "left";
  }
  if (distLeft < 120 && distRight > 120 && distTop > 50 && distBottom > 50) {
    return "right";
  }

  // Default to user fallback or top if enough space
  return distTop >= 50 ? "top" : "bottom";
}

export const Tooltip: Component<TooltipProps> = (props) => {
  const [local] = splitProps(props, [
    "content",
    "children",
    "placement",
    "openDelay",
    "closeDelay",
    "disabled",
    "class",
    "contentClass",
  ]);

  let triggerWrapperRef: HTMLDivElement | undefined;
  const [computedPlacement, setComputedPlacement] = createSignal<
    TooltipProps["placement"]
  >(local.placement || "top");

  const updatePlacement = () => {
    if (triggerWrapperRef) {
      const rect = triggerWrapperRef.getBoundingClientRect();
      const optimal = calculateOptimalPlacement(rect, local.placement || "top");
      setComputedPlacement(optimal);
    }
  };

  onMount(() => {
    updatePlacement();
    window.addEventListener("resize", updatePlacement, { passive: true });
  });

  return (
    <KobalteTooltip
      openDelay={local.openDelay ?? 150}
      closeDelay={local.closeDelay ?? 100}
      placement={computedPlacement()}
      gutter={6}
      overflowPadding={8}
      flip={"top bottom left right"}
      slide={true}
      disabled={local.disabled}
      onOpenChange={(open: boolean) => {
        if (open) {
          updatePlacement();
        }
      }}
    >
      <KobalteTooltip.Trigger
        as="div"
        ref={triggerWrapperRef}
        class={clsx("inline-flex items-center justify-center", local.class)}
        onMouseEnter={updatePlacement}
        onTouchStart={updatePlacement}
      >
        {local.children}
      </KobalteTooltip.Trigger>
      <KobalteTooltip.Portal>
        <KobalteTooltip.Content
          class={clsx(
            "shieldr-tooltip-content z-[9999] select-none rounded-lg border px-2.5 py-1 text-center text-xs font-medium leading-snug shadow-2xl backdrop-blur-xl transition-all duration-150",
            "border-slate-700/60 bg-slate-900/98 text-slate-100",
            // Dynamic position-aware styling via clsx
            {
              "origin-bottom": computedPlacement()?.startsWith("top"),
              "origin-top": computedPlacement()?.startsWith("bottom"),
              "origin-right": computedPlacement()?.startsWith("left"),
              "origin-left": computedPlacement()?.startsWith("right"),
              "max-w-[260px]":
                typeof window !== "undefined" && window.innerWidth <= 380,
              "max-w-[320px]":
                typeof window === "undefined" || window.innerWidth > 380,
            },
            local.contentClass
          )}
        >
          <KobalteTooltip.Arrow class={clsx("shieldr-tooltip-arrow fill-slate-900/98 stroke-slate-700/60")} />
          {local.content}
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  );
};
