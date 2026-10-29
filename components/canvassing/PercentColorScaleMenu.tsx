"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  bandRangeLabel,
  DEFAULT_PERCENT_COLOR_SCALE,
  loadPercentColorScale,
  PERCENT_COLOR_SCALE_EVENT,
  PERCENT_COLOR_TONES,
  percentToneLabel,
  percentToneSwatchClass,
  resetPercentColorScale,
  savePercentColorScale,
  type PercentColorScaleConfig,
  type PercentColorTone,
} from "@/lib/qc-recontact/percent-color-scale";

/** Subscribe to the shared localStorage percent color-scale config. */
export function usePercentColorScale(): PercentColorScaleConfig {
  const [config, setConfig] = useState<PercentColorScaleConfig>(() =>
    structuredClone(DEFAULT_PERCENT_COLOR_SCALE)
  );

  useEffect(() => {
    setConfig(loadPercentColorScale());
    const refresh = () => setConfig(loadPercentColorScale());
    window.addEventListener(PERCENT_COLOR_SCALE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PERCENT_COLOR_SCALE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return config;
}

function chipClass(active: boolean): string {
  return [
    "border px-2.5 py-1 text-xs font-medium disabled:opacity-50",
    active
      ? "border-[var(--section-accent)] bg-[color-mix(in_srgb,var(--section-accent)_12%,transparent)] text-[var(--section-ink)]"
      : "border-[var(--section-rule)] bg-transparent text-[var(--section-muted)] hover:border-[var(--section-accent)]",
  ].join(" ");
}

/** Compact submenu: enable coloring, assign a tone per percent band, reset defaults. */
export default function PercentColorScaleMenu() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<PercentColorScaleConfig>(() =>
    structuredClone(DEFAULT_PERCENT_COLOR_SCALE)
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    setConfig(loadPercentColorScale());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function commit(next: PercentColorScaleConfig) {
    setConfig(savePercentColorScale(next));
  }

  function setEnabled(enabled: boolean) {
    commit({ ...config, enabled });
  }

  function setBandTone(bandId: string, tone: PercentColorTone) {
    commit({
      ...config,
      bands: config.bands.map((band) => (band.id === bandId ? { ...band, tone } : band)),
    });
  }

  function onReset() {
    setConfig(resetPercentColorScale());
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={chipClass(open)}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        % colors
      </button>
      {open ? (
        <div
          id={menuId}
          className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-[var(--section-rule)] bg-white p-2 shadow-lg dark:bg-gray-900"
          role="group"
          aria-label="Percent color scale"
        >
          <label className="mb-2 flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="rounded border-gray-300"
            />
            <span>Color percent cells</span>
          </label>
          <ul className="space-y-2 border-t border-[var(--section-rule)] pt-2">
            {config.bands.map((band) => (
              <li key={band.id} className="space-y-1 px-1">
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--section-ink)]">
                  <span className="font-medium tabular-nums">{bandRangeLabel(band)}</span>
                  <span
                    className={`inline-block h-3 w-3 rounded-sm border ${percentToneSwatchClass(band.tone)}`}
                    title={percentToneLabel(band.tone)}
                    aria-hidden
                  />
                </div>
                <div className="flex flex-wrap gap-1" role="group" aria-label={`${bandRangeLabel(band)} color`}>
                  {PERCENT_COLOR_TONES.map((tone) => {
                    const selected = band.tone === tone;
                    return (
                      <button
                        key={tone}
                        type="button"
                        title={percentToneLabel(tone)}
                        aria-pressed={selected}
                        disabled={!config.enabled}
                        onClick={() => setBandTone(band.id, tone)}
                        className={[
                          "h-5 w-5 rounded-sm border disabled:opacity-40",
                          percentToneSwatchClass(tone),
                          selected ? "ring-2 ring-[var(--section-accent)] ring-offset-1" : "",
                        ].join(" ")}
                      />
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-[var(--section-rule)] pt-2">
            <button type="button" className={chipClass(false)} onClick={onReset}>
              Reset defaults
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
