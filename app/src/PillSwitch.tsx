import { useLayoutEffect, useRef, useState } from "react";

/** A choice between a few options, all visible, a selection pill sliding
 * under the picked one: Batch's sub-modes, and "Nouveau MKV / Sous-titres
 * seuls". `className` adds a look (the Batch drawer's). */
export function PillSwitch<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  disabledTitle,
  className = "",
  label,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  /** Every option but the picked one is off. */
  disabled?: boolean;
  disabledTitle?: string;
  className?: string;
  /** For screen readers: what's being chosen. */
  label: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  // No slide for the first placement: the pill just starts there.
  const [placed, setPlaced] = useState(false);

  // Measured again when the track's size changes: the font arriving, or the
  // switch shown after being hidden (nothing to measure while hidden).
  useLayoutEffect(() => {
    const measure = () => {
      const button = buttons.current[value];
      if (button && button.offsetWidth > 0) setPill({ left: button.offsetLeft, width: button.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, [value]);
  useLayoutEffect(() => {
    if (pill && !placed) requestAnimationFrame(() => setPlaced(true));
  }, [pill, placed]);

  return (
    <div ref={track} className={`pill-switch ${className}`} role="tablist" aria-label={label}>
      {pill && <span className={`pill-switch-pill${placed ? " placed" : ""}`} style={{ left: pill.left, width: pill.width }} />}
      {options.map(([option, text]) => (
        <button
          key={option}
          ref={(el) => {
            buttons.current[option] = el;
          }}
          role="tab"
          aria-selected={value === option}
          className={value === option ? "active" : ""}
          onClick={() => onChange(option)}
          disabled={disabled && value !== option}
          title={disabled && value !== option ? disabledTitle : undefined}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
