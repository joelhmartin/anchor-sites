import { createElement, Fragment } from "react";
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
  // to thread props for it. Use a Fragment-like passthrough by attaching
  // attrs to a div only when editable; in prod render the child as-is.
  if (editable) {
    return (
      <div data-block-id={block.id} data-block-type={block.type}>
        {children}
      </div>
    );
  }
  // Use Fragment to avoid adding markup noise in prod.
  return <Fragment>{children}</Fragment>;
}
