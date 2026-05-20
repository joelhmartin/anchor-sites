import { Label } from "../ui/label.js";

/**
 * Default brand tokens for the color editor. Keys follow the D-029
 * `--theme-<kebab>` convention; all values are 6-digit hex, which the
 * `<input type="color">` always produces, so any assembled token map is
 * `brandTokensSchema`-valid by construction. Shared by the new-site wizard
 * (P4-T4.11) and the settings tab (P4-T4.15).
 */
export const DEFAULT_BRAND_TOKENS: Record<string, string> = {
  "--theme-main": "#0a3d62",
  "--theme-on-main": "#ffffff",
  "--theme-accent": "#f6b93b",
  "--theme-on-accent": "#1f1f1f",
  "--theme-surface": "#ffffff",
  "--theme-on-surface": "#1f1f1f",
};

const PAIRS: { label: string; bg: string; on: string }[] = [
  { label: "Main", bg: "--theme-main", on: "--theme-on-main" },
  { label: "Accent", bg: "--theme-accent", on: "--theme-on-accent" },
  { label: "Surface", bg: "--theme-surface", on: "--theme-on-surface" },
];

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded-md border border-zinc-300 bg-white p-0.5"
        />
        <span className="font-mono text-xs text-zinc-500">{value}</span>
      </div>
    </div>
  );
}

/**
 * The brand-color editor: three Main/Accent/Surface pairs (each with a
 * "text on …" companion) plus a live preview swatch. Controlled — the parent
 * owns the `tokens` map and a per-key `onChange`. Reset-to-defaults lives in
 * the parent (using the exported `DEFAULT_BRAND_TOKENS`) so each screen can
 * place it where it wants.
 */
export function BrandTokenFields({
  tokens,
  onChange,
  previewLabel,
}: {
  tokens: Record<string, string>;
  onChange: (key: string, value: string) => void;
  previewLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        {PAIRS.map((p) => (
          <div key={p.bg} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3">
            <ColorField id={p.bg} label={p.label} value={tokens[p.bg]} onChange={(v) => onChange(p.bg, v)} />
            <ColorField
              id={p.on}
              label={`Text on ${p.label.toLowerCase()}`}
              value={tokens[p.on]}
              onChange={(v) => onChange(p.on, v)}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Preview</Label>
        <div
          className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4"
          style={{ background: tokens["--theme-surface"], color: tokens["--theme-on-surface"] }}
          data-testid="brand-preview"
        >
          <span className="text-sm font-medium">{previewLabel || "Your site"}</span>
          <div className="flex gap-2">
            <span
              className="rounded-md px-3 py-1 text-sm font-medium"
              style={{ background: tokens["--theme-main"], color: tokens["--theme-on-main"] }}
            >
              Main
            </span>
            <span
              className="rounded-md px-3 py-1 text-sm font-medium"
              style={{ background: tokens["--theme-accent"], color: tokens["--theme-on-accent"] }}
            >
              Accent
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
