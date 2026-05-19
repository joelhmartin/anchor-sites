import { describe, expect, it } from "vitest";
import { cn } from "./cn.js";

describe("cn", () => {
  it("composes conditionals via clsx", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });

  it("resolves Tailwind conflicts via tailwind-merge — last wins", () => {
    // p-2 + p-4 → only p-4 survives
    expect(cn("p-2 p-4")).toBe("p-4");
  });

  it("preserves non-conflicting classes", () => {
    expect(cn("p-2 m-4 text-red-500")).toBe("p-2 m-4 text-red-500");
  });
});
