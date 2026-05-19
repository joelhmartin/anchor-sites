type Props = { type: string; message: string; silent?: boolean };

export function BlockError({ type, message, silent }: Props) {
  // Silent placeholder in production — don't leak validation noise to public visitors.
  if (silent) {
    return <div data-block-error={type} aria-hidden="true" />;
  }
  return (
    <div
      data-block-error={type}
      style={{
        border: "2px dashed #c00",
        background: "#fff5f5",
        color: "#900",
        padding: "1rem",
        margin: "0.5rem 0",
        fontSize: "0.875rem",
      }}
    >
      <strong>{`Block error: ${type}`}</strong>
      <pre style={{ whiteSpace: "pre-wrap", margin: "0.5rem 0 0", fontSize: "0.8125rem" }}>
        {message}
      </pre>
    </div>
  );
}
