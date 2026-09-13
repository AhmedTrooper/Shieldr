import { Component, createSignal, For, onCleanup, onMount } from "solid-js";
import { clsx } from "clsx";
import { sound } from "../services/sound";

interface Ripple {
  id: number;
  x: number;
  y: number;
}

interface ShieldOverlayProps {
  opacity: number;
  blur: number;
  onBlockedInteraction: () => void;
  onUnlockRequest: () => void;
}

export const ShieldOverlay: Component<ShieldOverlayProps> = (props) => {
  const [ripples, setRipples] = createSignal<Ripple[]>([]);
  let rippleIdCounter = 0;

  const triggerRipple = (x: number, y: number) => {
    const id = ++rippleIdCounter;
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 700);
  };

  const handlePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    triggerRipple(e.clientX, e.clientY);
    sound.playBlockedClickThud();
    props.onBlockedInteraction();
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    triggerRipple(e.clientX, e.clientY);
    props.onBlockedInteraction();
  };

  // B-072: Block wheel events so a toddler cannot scroll YouTube to skip ads
  // or scroll the underlying app while locked.
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    props.onBlockedInteraction();
  };

  // B-074: Block drag-and-drop so files dropped onto the locked window are rejected.
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // B-071: Block app-switching combos outright — Tab, Meta (Cmd/Win), Alt.
    // These are the keys that escape the overlay via OS-level app switchers.
    const isEscapeKey = e.key === "Escape" || e.key === "Enter" || e.key === " ";
    // B-083: Block standalone Super/Meta/Win/OS keys too — these can pop the
    // start menu / launcher on their own, even without a modifier combo.
    const isSwitcherKey =
      e.key === "Tab" ||
      e.key === "Meta" ||
      e.key === "OS" ||
      e.key === "Hyper" ||
      e.key === "Super" ||
      e.altKey ||
      e.metaKey ||
      e.ctrlKey;

    // Special-case: Ctrl+Shift+Esc (Win Task Manager), Ctrl+Shift+I/J (DevTools),
    // F12 — block devtools opening while locked.
    const isDevtoolsCombo =
      e.key === "F12" ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && /^[IJij]$/.test(e.key));

    if (isEscapeKey) {
      // Don't stopPropagation — let UnlockModal's listener also receive
      // Escape so it can dismiss the modal. We only request unlock here;
      // if the modal is already open this is a no-op.
      e.preventDefault();
      props.onUnlockRequest();
      return;
    }

    if (isSwitcherKey || isDevtoolsCombo) {
      e.preventDefault();
      e.stopPropagation();
      props.onBlockedInteraction();
      return;
    }

    // Block any other keypress
    e.preventDefault();
    e.stopPropagation();
    props.onBlockedInteraction();
  };

  onMount(() => {
    window.addEventListener("contextmenu", handleContextMenu, { capture: true });
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    // B-072: wheel must be added non-passive so preventDefault() works.
    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  });

  onCleanup(() => {
    window.removeEventListener("contextmenu", handleContextMenu, { capture: true });
    window.removeEventListener("keydown", handleKeyDown, { capture: true });
    window.removeEventListener("wheel", handleWheel, { capture: true } as unknown as EventListenerOptions);
  });

  return (
    <div
      class={clsx("fixed inset-0 w-screen h-screen z-[999] cursor-default touch-none pointer-events-auto overflow-hidden")}
      style={{
        "background-color": `rgba(0, 0, 0, ${Number.isFinite(props.opacity) ? props.opacity : 0})`,
        // B-048: Number.isFinite guards against a NaN blur/opacity payload
        // (e.g. backend sent a non-numeric value) which would silently turn
        // off the blur effect — better to fall back to "none" deterministically.
        "backdrop-filter":
          Number.isFinite(props.blur) && props.blur > 0 ? `blur(${props.blur}px)` : "none",
        "-webkit-backdrop-filter":
          Number.isFinite(props.blur) && props.blur > 0 ? `blur(${props.blur}px)` : "none",
      }}
      onPointerDown={handlePointerDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Visual ripple feedback for blocked clicks */}
      <For each={ripples()}>
        {(ripple) => (
          <span
            class={clsx(
              "absolute w-[100px] h-[100px] rounded-full -translate-x-1/2 -translate-y-1/2 scale-0",
              "bg-[radial-gradient(circle,rgba(255,255,255,0.4)_0%,rgba(255,255,255,0)_70%)]",
              "animate-[rippleExpand_0.7s_cubic-bezier(0.1,0.8,0.3,1)_forwards] pointer-events-none"
            )}
            style={{
              left: `${ripple.x}px`,
              top: `${ripple.y}px`,
            }}
          />
        )}
      </For>
    </div>
  );
};
