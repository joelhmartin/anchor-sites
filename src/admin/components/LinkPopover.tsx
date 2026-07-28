import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Button } from "../ui/button.js";

export type LinkPopoverProps = {
  open: boolean;
  initialValue?: string;
  onClose: () => void;
  onSave: (url: string) => void;
};

const URL_PATTERN = /^https?:\/\/.+/i;

/**
 * Tiny link-edit dialog (Task 11), opened from the inline editor's
 * `onLinkEditRequest`. A single URL field with Save/Cancel and basic
 * `https?://` validation before handing the value off to `handle.applyField`.
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
    if (!URL_PATTERN.test(trimmed)) {
      setError("Enter a valid http:// or https:// URL.");
      return;
    }
    onSave(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>Edit link</DialogTitle>
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
            placeholder="https://example.com"
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
