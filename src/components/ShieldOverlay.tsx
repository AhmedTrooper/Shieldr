import { Component, createSignal, For, onCleanup, onMount } from "solid-js";
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

  const handleKeyDown = (e: KeyboardEvent) => {
    // Intercept keys to prevent toddlers from escaping
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      props.onUnlockRequest();
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
  });

  onCleanup(() => {
    window.removeEventListener("contextmenu", handleContextMenu, { capture: true });
    window.removeEventListener("keydown", handleKeyDown, { capture: true });
  });

  return (
    <div
      class="shield-fullscreen-blocker"
      style={{
        "background-color": `rgba(0, 0, 0, ${props.opacity})`,
        "backdrop-filter": props.blur > 0 ? `blur(${props.blur}px)` : "none",
        "-webkit-backdrop-filter": props.blur > 0 ? `blur(${props.blur}px)` : "none",
      }}
      onPointerDown={handlePointerDown}
    >
      {/* Visual ripple feedback for blocked clicks */}
      <For each={ripples()}>
        {(ripple) => (
          <span
            class="touch-block-ripple"
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
