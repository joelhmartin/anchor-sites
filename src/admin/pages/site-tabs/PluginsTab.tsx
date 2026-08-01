import { useMemo, useState } from "react";
import { apiFetch } from "../../lib/apiFetch.js";
import { useApi } from "../../lib/useApi.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";
import { Spinner } from "../../ui/spinner.js";

/**
 * Plugins tab (P7.5-T7.5.8). Lists available plugins (from the runtime
 * registry) and lets the operator enable/disable each one per-site + edit its
 * config. The config form is generated from the plugin's `config_schema` (the
 * server serializes the plugin's Zod schema via zod-to-json-schema). Secret
 * fields render as password inputs showing set/unset — the API never returns a
 * secret value, and an omitted/blank secret is preserved on save.
 */

type JsonSchemaProp = {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  title?: string;
  description?: string;
};
type PluginBlock = { type: string; label: string; description?: string };
type AvailablePlugin = {
  name: string;
  version: string;
  required_env: string[];
  /** D438 — required env vars absent on the server (names only). */
  missing_env: string[];
  secret_config_keys: string[];
  has_router: boolean;
  blocks: PluginBlock[];
  config_schema: { properties?: Record<string, JsonSchemaProp> } | null;
};
type InstalledPlugin = {
  plugin_name: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets_set: string[];
};

/** Turn a raw config key into a readable label when the schema gives no title. */
function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/** D434 — coerce a widget's raw value to the config_schema type on save. */
function coerceValue(type: string | undefined, raw: unknown): unknown {
  if (type === "boolean") return Boolean(raw);
  if (type === "number" || type === "integer") {
    if (raw === "" || raw === undefined || raw === null) return undefined;
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

export function PluginsTab({ siteId }: { siteId: string }) {
  const available = useApi<{ plugins: AvailablePlugin[] }>("/api/plugins");
  const installed = useApi<{ plugins: InstalledPlugin[] }>(`/api/sites/${siteId}/plugins`);

  if (available.loading || installed.loading) return <Spinner />;
  if (available.error) return <p className="text-sm text-red-600">{available.error}</p>;
  // D413 — a failed installed-plugins fetch must NOT masquerade as "everything
  // disabled with default config": every card would then render enabled=false
  // with schema defaults, and clicking Save would overwrite the real per-site
  // config with those defaults. Block on it instead.
  if (installed.error) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-red-600">
          Couldn’t load this site’s plugin settings: {installed.error}
        </p>
        <p className="text-sm text-zinc-500">
          Saving is disabled until this loads — otherwise defaults would overwrite the site’s real
          plugin config.
        </p>
        <Button size="sm" variant="outline" className="self-start" onClick={() => installed.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  const plugins = available.data?.plugins ?? [];
  const byName = new Map((installed.data?.plugins ?? []).map((p) => [p.plugin_name, p]));

  if (plugins.length === 0) {
    return <p className="text-sm text-zinc-500">No plugins are available.</p>;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {plugins.map((p) => (
        <PluginCard
          key={p.name}
          siteId={siteId}
          plugin={p}
          installed={byName.get(p.name)}
          onChanged={() => {
            installed.reload();
          }}
        />
      ))}
    </div>
  );
}

function PluginCard({
  siteId,
  plugin,
  installed,
  onChanged,
}: {
  siteId: string;
  plugin: AvailablePlugin;
  installed?: InstalledPlugin;
  onChanged: () => void;
}) {
  const props = plugin.config_schema?.properties ?? {};
  const secretKeys = new Set(plugin.secret_config_keys);
  const unmetEnv = plugin.missing_env ?? [];

  const initialValues = useMemo(() => {
    const v: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(props)) {
      if (secretKeys.has(key)) {
        v[key] = ""; // secrets start blank; blank = preserve existing
      } else {
        const current = installed?.config?.[key];
        // D434 — keep the value's native type (boolean/number), don't String() it.
        v[key] = current !== undefined ? current : (def.default ?? (def.type === "boolean" ? false : ""));
      }
    }
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.name]);

  const [enabled, setEnabled] = useState(installed?.enabled ?? false);
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setValue(key: string, value: unknown) {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    // Build config: non-secret always sent (typed); secret only when the user
    // typed one.
    const config: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(props)) {
      if (secretKeys.has(key)) {
        if (values[key]) config[key] = values[key];
      } else {
        config[key] = coerceValue(def.type, values[key]);
      }
    }
    try {
      await apiFetch(`/api/sites/${siteId}/plugins/${plugin.name}`, {
        method: "PUT",
        body: Object.keys(props).length > 0 ? { enabled, config } : { enabled },
      });
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save plugin.");
    } finally {
      setBusy(false);
    }
  }

  // D439 — a first-time operator must learn what enabling adds. Surface the
  // blocks the plugin provides (and whether it mounts routes) from the payload.
  const blockList = plugin.blocks ?? [];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-medium">{plugin.name}</p>
            <p className="text-xs text-zinc-400">v{plugin.version}</p>
            {blockList.length > 0 && (
              <p className="text-xs text-zinc-500">
                Provides blocks: {blockList.map((b) => b.label).join(", ")}
              </p>
            )}
            {plugin.has_router && (
              <p className="text-xs text-zinc-500">Adds server routes for this site.</p>
            )}
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={`Enable ${plugin.name}`}
              checked={enabled}
              // D438 — can't turn on a plugin whose required env is missing.
              disabled={unmetEnv.length > 0 && !enabled}
              onChange={(e) => {
                setSaved(false);
                setEnabled(e.target.checked);
              }}
            />
            Enabled
          </label>
        </div>

        {/* D438 — unmet-env warning chip. */}
        {unmetEnv.length > 0 && (
          <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700" role="status">
            Missing configuration: {unmetEnv.join(", ")} — this plugin can’t be enabled until it’s
            set on the server.
          </p>
        )}

        {Object.entries(props).map(([key, def]) => {
          const isSecret = secretKeys.has(key);
          const fieldId = `plg-${plugin.name}-${key}`;
          const label = def.title ?? humanizeKey(key);
          const isBoolean = def.type === "boolean";
          const isNumber = def.type === "number" || def.type === "integer";
          return (
            <div key={key} className="flex flex-col gap-1">
              {isBoolean ? (
                <label className="flex items-center gap-2 text-sm" htmlFor={fieldId}>
                  <input
                    id={fieldId}
                    type="checkbox"
                    checked={Boolean(values[key])}
                    onChange={(e) => setValue(key, e.target.checked)}
                  />
                  {label}
                </label>
              ) : (
                <>
                  <Label htmlFor={fieldId}>
                    {label}
                    {isSecret && (
                      <span className="ml-2 text-xs text-zinc-400">
                        {installed?.secrets_set?.includes(key) ? "(set — leave blank to keep)" : "(not set)"}
                      </span>
                    )}
                  </Label>
                  {def.enum ? (
                    <select
                      id={fieldId}
                      className="rounded border border-zinc-300 px-2 py-1 text-sm"
                      value={String(values[key] ?? "")}
                      onChange={(e) => setValue(key, e.target.value)}
                    >
                      {def.enum.map((opt) => (
                        <option key={String(opt)} value={String(opt)}>
                          {String(opt)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={fieldId}
                      type={isSecret ? "password" : isNumber ? "number" : "text"}
                      value={values[key] === undefined || values[key] === null ? "" : String(values[key])}
                      onChange={(e) => setValue(key, e.target.value)}
                    />
                  )}
                </>
              )}
              {/* D439 — the field's own schema description as helper text, so a
                  raw config key never has to double as its only explanation. */}
              {def.description && <p className="text-xs text-zinc-400">{def.description}</p>}
            </div>
          );
        })}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : "Save"}
          </Button>
          {saved && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </CardContent>
    </Card>
  );
}
