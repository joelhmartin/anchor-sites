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

type JsonSchemaProp = { type?: string; enum?: unknown[]; default?: unknown };
type AvailablePlugin = {
  name: string;
  version: string;
  required_env: string[];
  secret_config_keys: string[];
  has_router: boolean;
  blocks: Array<{ type: string; label: string }>;
  config_schema: { properties?: Record<string, JsonSchemaProp> } | null;
};
type InstalledPlugin = {
  plugin_name: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets_set: string[];
};

export function PluginsTab({ siteId }: { siteId: string }) {
  const available = useApi<{ plugins: AvailablePlugin[] }>("/api/plugins");
  const installed = useApi<{ plugins: InstalledPlugin[] }>(`/api/sites/${siteId}/plugins`);

  if (available.loading || installed.loading) return <Spinner />;
  if (available.error) return <p className="text-sm text-red-600">{available.error}</p>;

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

  const initialValues = useMemo(() => {
    const v: Record<string, string> = {};
    for (const [key, def] of Object.entries(props)) {
      if (secretKeys.has(key)) {
        v[key] = ""; // secrets start blank; blank = preserve existing
      } else {
        const current = installed?.config?.[key];
        v[key] = current !== undefined ? String(current) : String(def.default ?? "");
      }
    }
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.name]);

  const [enabled, setEnabled] = useState(installed?.enabled ?? false);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setValue(key: string, value: string) {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    // Build config: non-secret always sent; secret only when the user typed one.
    const config: Record<string, unknown> = {};
    for (const [key] of Object.entries(props)) {
      if (secretKeys.has(key)) {
        if (values[key]) config[key] = values[key];
      } else {
        config[key] = values[key];
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

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{plugin.name}</p>
            <p className="text-xs text-zinc-400">v{plugin.version}</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={`Enable ${plugin.name}`}
              checked={enabled}
              onChange={(e) => {
                setSaved(false);
                setEnabled(e.target.checked);
              }}
            />
            Enabled
          </label>
        </div>

        {Object.entries(props).map(([key, def]) => {
          const isSecret = secretKeys.has(key);
          const fieldId = `plg-${plugin.name}-${key}`;
          return (
            <div key={key} className="flex flex-col gap-1">
              <Label htmlFor={fieldId}>
                {key}
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
                  value={values[key] ?? ""}
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
                  type={isSecret ? "password" : "text"}
                  value={values[key] ?? ""}
                  onChange={(e) => setValue(key, e.target.value)}
                />
              )}
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
