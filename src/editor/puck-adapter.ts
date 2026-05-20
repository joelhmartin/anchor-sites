import type { Block } from "../blocks/types.js";
// Type-only import: the adapter has NO runtime dependency on Puck, so it (and
// its tests) run in plain node without loading @measured/puck.
import type { ComponentData, Data } from "./index.js";

/**
 * `Block[]` <-> Puck `Data` conversion (D-001 / D-017 / D-036).
 *
 * Our canonical `Block[]` (`{ id, type, props, children? }`) is the source of
 * truth; Puck `Data` (`{ root, content, zones? }`) is only a view. The mapping:
 *
 * - Top-level blocks  -> `data.content` (one `ComponentData` each).
 * - `block.id`        -> stored inside `ComponentData.props.id` (Puck's `WithId`
 *                        convention). Therefore a block's own `props` must NOT
 *                        contain a reserved `id` key.
 * - `block.props`     -> spread into `ComponentData.props` alongside `id`.
 * - `block.children`  -> flattened into Puck's `zones` map under the key
 *                        `${block.id}:children`, recursively for every depth.
 *                        nanoid ids never contain ":" so the key is unambiguous.
 * - `data.root`       -> always `{}` here; `Block[]` carries no page-level root
 *                        props (page seo/status live outside the blocks array).
 *
 * The conversion is purely structural: it never consults the block registry,
 * so unknown block `type`s round-trip unchanged. `fromPuckData(toPuckData(x))`
 * deep-equals `x` is a tested invariant.
 */
export const CHILDREN_ZONE = "children";

const childrenZoneKey = (blockId: string): string => `${blockId}:${CHILDREN_ZONE}`;

export function toPuckData(blocks: Block[]): Data {
  const zones: Record<string, ComponentData[]> = {};

  const walk = (list: Block[]): ComponentData[] =>
    list.map((block) => {
      if (block.children !== undefined) {
        zones[childrenZoneKey(block.id)] = walk(block.children);
      }
      return {
        type: block.type,
        props: { ...block.props, id: block.id },
      } as ComponentData;
    });

  const content = walk(blocks);
  const data: Data = { root: {}, content };
  if (Object.keys(zones).length > 0) {
    data.zones = zones;
  }
  return data;
}

export function fromPuckData(data: Data): Block[] {
  const zones = data.zones ?? {};

  const toBlock = (cd: ComponentData): Block => {
    const { id, ...props } = cd.props as { id: string } & Record<string, unknown>;
    const block: Block = { id, type: cd.type, props };
    const childZone = zones[childrenZoneKey(id)];
    if (childZone !== undefined) {
      block.children = childZone.map(toBlock);
    }
    return block;
  };

  return data.content.map(toBlock);
}
