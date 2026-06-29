import { memo } from "react";
import type { PhoneNumberProps } from "./schema.js";

/**
 * D-052 anchor #5b: React.memo with () => true comparator so CTM's DOM
 * swap on the tel link is never clobbered by a re-render after mount.
 */
export const PhoneNumber = memo(
  function PhoneNumberInner({ number, display }: PhoneNumberProps) {
    return (
      <span className="ac-phone-number">
        <a href={`tel:${number}`} className="ac-phone-number__link">
          {display ?? number}
        </a>
      </span>
    );
  },
  () => true,
);
