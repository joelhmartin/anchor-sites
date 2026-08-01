// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { JobsHealthPage } from "./JobsHealthPage.js";
import { setAdminToken, clearAdminToken } from "../lib/adminToken.js";

function mockHealth(body: unknown) {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
  ) as unknown as typeof fetch;
}

const UP_HEALTH = {
  enabled: true,
  runner: { status: "up", error: null, since: "2026-07-31T00:00:00.000Z" },
  lastBossError: null,
  queues: [
    { name: "site.provision", active: 1, queued: 3, retry: 0, failed: 0, completed: 5, oldestPendingAgeSeconds: 42 },
    { name: "git.export", active: 0, queued: 0, retry: 1, failed: 2, completed: 9, oldestPendingAgeSeconds: 900 },
  ],
};

describe("JobsHealthPage (D606/D1009)", () => {
  const realFetch = global.fetch;
  beforeEach(() => setAdminToken("tok"));
  afterEach(() => {
    cleanup();
    clearAdminToken();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("renders a row per queue with its failed count highlighted", async () => {
    mockHealth(UP_HEALTH);
    render(
      <MemoryRouter>
        <JobsHealthPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("site.provision")).toBeTruthy());
    expect(screen.getByText("git.export")).toBeTruthy();
    // The failed job is visible from the product.
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("surfaces a down worker + last boss error", async () => {
    mockHealth({
      enabled: false,
      runner: { status: "down", error: "boot blew up", since: "2026-07-31T00:00:00.000Z" },
      lastBossError: { message: "maintenance loop died", at: "2026-07-31T01:00:00.000Z" },
      queues: [],
    });
    render(
      <MemoryRouter>
        <JobsHealthPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/job runner is down/i)).toBeTruthy());
    expect(screen.getByText(/maintenance loop died/i)).toBeTruthy();
  });
});
