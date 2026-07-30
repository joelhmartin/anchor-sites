import * as React from "react";
import { Editable, EditModeContext } from "../../editable.js";
import type { AnnouncementBarProps } from "./schema.js";

export function AnnouncementBar({ text, link_label, link_href }: AnnouncementBarProps) {
  const editMode = React.useContext(EditModeContext);

  return (
    <div
      role="region"
      aria-label="Announcement"
      className="ac-announcement-bar py-2.5 px-4 bg-theme-accent text-theme-on-accent text-center text-sm"
    >
      <div className="ac-announcement-bar__inner max-w-6xl mx-auto flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <Editable field="text" as="span" className="ac-announcement-bar__text font-medium" value={text} />
        {(link_label || editMode) && (
          <a
            href={link_href}
            className="ac-announcement-bar__link font-semibold underline underline-offset-2 hover:opacity-90"
          >
            <Editable field="link_label" value={link_label} placeholder="Add a link label…" />
          </a>
        )}
      </div>
    </div>
  );
}
