import { createElement } from "react";
import type { Block } from "../blocks/types.js";
import { getBlock } from "../blocks/registry.js";
import { BlockError } from "./BlockError.js";
import { UnknownBlock } from "./UnknownBlock.js";

type Props = {
  blocks: Block[];
  /** When true, blocks render with data-* attrs the editor uses (Phase 5). */
  editable?: boolean;
};

/**
 * Production guard for error visibility. In production, validation failures
 * render a silent placeholder instead of leaking error UI to public visitors.
 */
const isProd = () => process.env.NODE_ENV === "production";

export function BlockRenderer({ blocks, editable }: Props) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  return (
    <>
      {blocks.map((block) => {
        const entry = getBlock(block.type);

        if (!entry) {
          return (
            <Wrap key={block.id} block={block} editable={editable}>
              <UnknownBlock type={block.type} silent={isProd()} />
            </Wrap>
          );
        }

        const parsed = entry.schema.safeParse(block.props);
        if (!parsed.success) {
          return (
            <Wrap key={block.id} block={block} editable={editable}>
              <BlockError
                type={block.type}
                message={parsed.error.errors.map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`).join("\n")}
                silent={isProd()}
              />
            </Wrap>
          );
        }

        const Component = entry.component;
        return (
          <Wrap key={block.id} block={block} editable={editable}>
            {createElement(Component, parsed.data)}
          </Wrap>
        );
      })}
    </>
  );
}

function Wrap({
  block,
  editable,
  children,
}: {
  block: Block;
  editable?: boolean;
  children: React.ReactNode;
}) {
  // The wrapper carries the data-block-* attrs so the Phase 5 editor can
  // resolve clicks back to a block id without the inner component having
  // to thread props for it.
  //
  // D706 — BOTH paths emit `id={block.id}`: templates author in-page anchors
  // (`#new-patients-forms`, hero CTAs targeting a block) and the prod path
  // used to render a bare Fragment, so no `#block-id` link ever resolved on
  // a live site. A plain block-level div adds no layout of its own; the id
  // makes every block an addressable anchor target in prod and preview alike.
  if (editable) {
    return (
      <div id={block.id} data-block-id={block.id} data-block-type={block.type}>
        {children}
      </div>
    );
  }
  return <div id={block.id}>{children}</div>;
}
