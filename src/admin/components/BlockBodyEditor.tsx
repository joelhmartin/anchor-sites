import { useMemo } from "react";
import { Puck } from "../../editor/index.js";
import type { Data } from "../../editor/index.js";
import "@measured/puck/puck.css";
import { buildPuckConfig } from "../../editor/puck-config.js";
import { fromPuckData, toPuckData } from "../../editor/puck-adapter.js";
import type { Block } from "../../blocks/types.js";

/**
 * Reusable Block[] body editor (P8-T8.13). Wraps the ONE Puck boundary
 * (D-017) so blog posts and events edit their `Block[]` body/description with
 * the SAME editor + block registry as pages — `Block[]` stays the source of
 * truth (D-001). The host page owns metadata (title/slug/status) and the save
 * call; this component only converts blocks ⇄ Puck `Data` and fires
 * `onPublish` with canonical `Block[]`.
 */
export function BlockBodyEditor({
  siteId,
  value,
  onPublish,
}: {
  siteId: string;
  value: Block[];
  onPublish: (blocks: Block[]) => void;
}) {
  const config = useMemo(() => buildPuckConfig({ siteId }), [siteId]);
  const data = useMemo(() => toPuckData(value), [value]);
  return (
    <Puck
      config={config}
      data={data}
      onPublish={(d: Data) => onPublish(fromPuckData(d))}
    />
  );
}
