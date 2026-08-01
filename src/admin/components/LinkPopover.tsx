import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription } from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Button } from "../ui/button.js";

export type LinkPopoverProps = {
  open: boolean;
  initialValue?: string;
  onClose: () => void;
  onSave: (url: string) => void;
};

/**
 * D330 — the link kinds the product itself authors, mirroring the classes
 * `preview-links.ts` recognizes when rewriting rendered hrefs:
 *  - absolute `http(s)://…`
 *  - protocol-relative `//host/…`
 *  - site-relative `/about`, `/services/dental`
 *  - `mailto:` / `tel:`
 *  - in-page `#anchor`
 * The old `/^https?:\/\/.+/i` rejected everything except the first — so an
 * operator could not inline-edit a button to point at their own About page,
 * even though templates and the agent do exactly that constantly.
 */
function isAcceptableLinkTarget(value: string): boolean {
  if (!value) return false;
  if (/^https?:\/\/.+/i.test(value)) return true; // absolute
  if (/^\/\/.+/.test(value)) return true; // protocol-relative //host
  if (/^\/[^/]?/.test(value) || value === "/") return true; // site-relative /path
  if (/^mailto:.+@.+/i.test(value)) return true;
  if (/^tel:.+/i.test(value)) return true;
  if (/^#.+/.test(value)) return true; // in-page anchor
  return false;
}

/**
 * Tiny link-edit dialog (Task 11), opened from the inline editor's
 * `onLinkEditRequest`. A single URL field with Save/Cancel; validation
 * accepts every link class the product authors (D330).
 */
export function LinkPopover({ open, initialValue, onClose, onSave }: LinkPopoverProps) {
  const [value, setValue] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue ?? "");
      setError(null);
    }
    // Reset only on open transitions — mirrors ImagePickerDialog's pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    const trimmed = value.trim();
    if (!isAcceptableLinkTarget(trimmed)) {
      setError("Enter a URL (https://…), a page path (/about), an anchor (#section), or mailto:/tel:.");
      return;
    }
    onSave(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent title="Edit link" className="max-w-md">
        <DialogDescription>Where should this link go?</DialogDescription>

        <div className="mt-4 flex flex-col gap-1">
          <Label htmlFor="link-popover-url">URL</Label>
          <Input
            id="link-popover-url"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="https://example.com, /about, #section, or mailto:hi@…"
            autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
