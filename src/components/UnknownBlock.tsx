type Props = { type: string; silent?: boolean };

export function UnknownBlock({ type, silent }: Props) {
  if (silent) {
    return <div data-block-unknown={type} aria-hidden="true" />;
  }
  return (
    <div
      data-block-unknown={type}
      style={{
        border: "2px dashed #999",
        background: "#fafafa",
        color: "#555",
        padding: "1rem",
        margin: "0.5rem 0",
        fontSize: "0.875rem",
      }}
    >
      <strong>Unknown block type:</strong> <code>{type}</code>
    </div>
  );
}
