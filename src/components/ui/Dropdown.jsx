import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";

export function Dropdown({ trigger, children, align = "left", className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div
          className={clsx(
            "absolute z-20 mt-2 min-w-[200px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg",
            align === "right" ? "right-0" : "left-0",
            className,
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({ children, onClick, className }) {
  return (
    <button
      className={clsx(
        "w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
