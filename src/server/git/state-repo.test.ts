import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAgentDb } from "../../../tests/helpers/agent-db.js";
import {
  getGitState, setGitEnabled, recordExport, recordImport, recordGitError,
} from "./state-repo.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = setupAgentDb();

d("site_git_state repo", () => {
  let siteId: string;

  beforeAll(async () => {
    await db.runMigrations();
    siteId = (await db.seedSite("git-state-repo-a")).id;
  });
  afterAll(() => db.teardown());

  it("returns null for a site with no git state row", async () => {
    const otherSiteId = (await db.seedSite("git-state-repo-none")).id;
    expect(await getGitState(db.getPool(), otherSiteId)).toBeNull();
  });

  it("upserts enable -> disable round-trip", async () => {
    const enabled = await setGitEnabled(db.getPool(), siteId, true);
    expect(enabled).toMatchObject({ site_id: siteId, enabled: true });

    const disabled = await setGitEnabled(db.getPool(), siteId, false);
    expect(disabled).toMatchObject({ site_id: siteId, enabled: false });

    // Still exactly one row for this site (upsert, not insert-again).
    const fetched = await getGitState(db.getPool(), siteId);
    expect(fetched).toMatchObject({ site_id: siteId, enabled: false });
  });

  it("recordExport sets sha + last_synced_at and clears a previously recorded error", async () => {
    const siteId2 = (await db.seedSite("git-state-repo-b")).id;
    await setGitEnabled(db.getPool(), siteId2, true);
    await recordGitError(db.getPool(), siteId2, "boom");
    let state = await getGitState(db.getPool(), siteId2);
    expect(state!.last_error).toBe("boom");

    await recordExport(db.getPool(), siteId2, "abc123");
    state = await getGitState(db.getPool(), siteId2);
    expect(state!.last_export_sha).toBe("abc123");
    expect(state!.last_synced_at).not.toBeNull();
    expect(state!.last_error).toBeNull();
  });

  it("recordImport sets last_import_sha + last_synced_at and clears a previously recorded error", async () => {
    const siteId3 = (await db.seedSite("git-state-repo-c")).id;
    await setGitEnabled(db.getPool(), siteId3, true);
    await recordGitError(db.getPool(), siteId3, "kaboom");

    await recordImport(db.getPool(), siteId3, "def456");
    const state = await getGitState(db.getPool(), siteId3);
    expect(state!.last_import_sha).toBe("def456");
    expect(state!.last_synced_at).not.toBeNull();
    expect(state!.last_error).toBeNull();
  });

  it("recordGitError truncates a 600-char message to 500 chars", async () => {
    const siteId4 = (await db.seedSite("git-state-repo-d")).id;
    await setGitEnabled(db.getPool(), siteId4, true);
    const longMessage = "x".repeat(600);
    await recordGitError(db.getPool(), siteId4, longMessage);
    const state = await getGitState(db.getPool(), siteId4);
    expect(state!.last_error).toHaveLength(500);
    expect(state!.last_error).toBe("x".repeat(500));
  });

  it("cascade deletes the git state row when the site is deleted", async () => {
    const siteId5 = (await db.seedSite("git-state-repo-e")).id;
    await setGitEnabled(db.getPool(), siteId5, true);
    expect(await getGitState(db.getPool(), siteId5)).not.toBeNull();

    await db.getPool().query("DELETE FROM sites WHERE id = $1", [siteId5]);
    expect(await getGitState(db.getPool(), siteId5)).toBeNull();
  });
});
