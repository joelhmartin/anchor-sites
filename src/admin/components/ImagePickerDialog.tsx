import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription } from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Button } from "../ui/button.js";
import { cn } from "../ui/cn.js";
import { imageSources, type PickedImage } from "./image-sources.js";

export type ImagePickerDialogProps = {
  siteId: string;
  open: boolean;
  initialAlt?: string;
  onClose: () => void;
  onPick: (p: PickedImage) => void;
};

/**
 * Pluggable image picker (Task 10). A tab strip over `imageSources` —
 * library, upload, stock — plus a shared alt-text input above the tabs
 * whose value threads into every source's `onPick`. Each source is data +
 * behavior (`ImageSource`); the dialog only renders the active one, so a
 * future AI-generation source is just another entry in `imageSources`.
 */
export function ImagePickerDialog({ siteId, open, initialAlt, onClose, onPick }: ImagePickerDialogProps) {
  const [activeId, setActiveId] = useState(imageSources[0].id);
  const [alt, setAlt] = useState(initialAlt ?? "");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAlt(initialAlt ?? "");
      setActiveId(imageSources[0].id);
      setMessage(null);
    }
    // Reset only on open transitions — initialAlt is a per-open snapshot, not
    // something that should re-trigger while the dialog is already open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const active = imageSources.find((s) => s.id === activeId) ?? imageSources[0];
  const ActiveComponent = active.Component;

  function handlePick(p: PickedImage) {
    onPick(p);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent title="Choose an image" className="max-w-2xl">
        <DialogDescription>Pick from your library, upload a new file, or search stock photos.</DialogDescription>

        <div className="mt-4 flex flex-col gap-1">
          <Label htmlFor="picker-alt">Alt text</Label>
          <Input
            id="picker-alt"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="Describe the image for screen readers"
          />
        </div>

        <div className="mt-4 flex gap-1 border-b border-zinc-200" role="tablist">
          {imageSources.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === activeId}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                s.id === activeId
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-zinc-500 hover:text-zinc-700",
              )}
              onClick={() => {
                setActiveId(s.id);
                setMessage(null);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {message && <p className="mt-3 text-sm text-amber-600">{message}</p>}

        <div className="mt-4 max-h-96 overflow-auto">
          <ActiveComponent siteId={siteId} alt={alt} onPick={handlePick} onError={setMessage} />
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
