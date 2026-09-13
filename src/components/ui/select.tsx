import { Component } from "solid-js";
import { Select as KobalteSelect } from "@kobalte/core/select";
import { Check, ChevronDown } from "lucide-solid";
import { cn } from "../../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  triggerClass?: string;
  ariaLabel?: string;
}

/**
 * Custom-styled Select component matching the Shieldr dark theme.
 * Built on Kobalte for full keyboard accessibility + consistent visuals.
 */
export const Select: Component<SelectProps> = (props) => {
  return (
    <KobalteSelect<SelectOption>
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      optionDisabled="disabled"
      value={props.options.find((o) => o.value === props.value)}
      defaultValue={
        props.defaultValue
          ? props.options.find((o) => o.value === props.defaultValue)
          : undefined
      }
      onChange={(opt) => props.onChange?.(opt?.value ?? null)}
      disabled={props.disabled}
      placeholder={props.placeholder ?? "Select..."}
      itemComponent={(itemProps) => (
        <KobalteSelect.Item
          item={itemProps.item}
          class={cn(
            "relative flex items-center justify-between gap-2 px-3 py-2 rounded-md text-xs font-medium",
            "text-slate-200 cursor-pointer select-none outline-none",
            "hover:bg-blue-500/15 hover:text-white",
            "focus-visible:bg-blue-500/15 focus-visible:text-white",
            "data-[highlighted]:bg-blue-500/15 data-[highlighted]:text-white",
            "data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed data-[disabled]:pointer-events-none",
            "transition-colors"
          )}
        >
          <KobalteSelect.ItemLabel class="truncate min-w-0 flex-1">
            {itemProps.item.rawValue.label}
          </KobalteSelect.ItemLabel>
          <KobalteSelect.ItemIndicator class="shrink-0 text-blue-400">
            <Check size={13} />
          </KobalteSelect.ItemIndicator>
        </KobalteSelect.Item>
      )}
    >
      <KobalteSelect.Trigger
        class={cn(
          "w-full h-9 px-3 rounded-lg bg-slate-800 border border-white/15 text-slate-200 text-xs font-semibold",
          "inline-flex items-center justify-between gap-2 cursor-pointer outline-none select-none",
          "hover:border-blue-400/50 focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/40",
          "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
          props.triggerClass
        )}
        aria-label={props.ariaLabel}
      >
        <KobalteSelect.Value<SelectOption> class="truncate min-w-0 flex-1 text-left">
          {(state) =>
            state.selectedOption()?.label ?? (
              <span class="text-slate-500 font-normal">
                {props.placeholder ?? "Select..."}
              </span>
            )
          }
        </KobalteSelect.Value>
        <KobalteSelect.Icon
          class="shrink-0 text-slate-400 transition-transform ui-expanded:rotate-180 ui-expanded:text-blue-400"
        >
          <ChevronDown size={14} />
        </KobalteSelect.Icon>
      </KobalteSelect.Trigger>

      <KobalteSelect.Portal>
        <KobalteSelect.Content
          class={cn(
            "z-[2000] min-w-[var(--kb-select-trigger-width)] rounded-lg overflow-hidden",
            "bg-slate-900/98 backdrop-blur-xl border border-white/15 shadow-2xl shadow-black/60",
            "animate-[fadeIn_0.12s_ease-out]",
            props.class
          )}
          style={{
            "max-height": "var(--kb-select-content-max-height)",
          }}
        >
          <KobalteSelect.Listbox
            class={cn(
              "p-1 max-h-[260px] overflow-y-auto overscroll-contain",
              "outline-none"
            )}
          />
        </KobalteSelect.Content>
      </KobalteSelect.Portal>
    </KobalteSelect>
  );
};
