/* eslint-disable camelcase */

// P3-T3.6 — media_assets table (D-022).
//
// One row per uploaded original. The variant-generation pg-boss job
// (P3-T3.10) writes the variants[] array + flips variants_status from
// 'pending' → 'processing' → 'ready'. GCS keys live under a per-site
// prefix: <site_id>/originals/<asset_id>.<ext> and per-variant
// <site_id>/variants/<asset_id>-<variant>.<hash>.<ext>.

exports.up = (pgm) => {
  pgm.createTable("media_assets", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    site_id: {
      type: "uuid",
      notNull: true,
      references: '"sites"',
      onDelete: "CASCADE",
    },
    // Canonical GCS key for the ORIGINAL upload. Variants derive their
    // keys at job-time from this + variant + content hash.
    gcs_key: { type: "text", notNull: true, unique: true },
    content_type: { type: "text", notNull: true },
    alt: { type: "text", notNull: true, default: "" },
    // { x: 0-1, y: 0-1 } — used by the renderer's <Image> block for
    // object-position. Nullable when the admin didn't pick one.
    focal_point: { type: "jsonb" },
    variants_status: {
      type: "text",
      notNull: true,
      default: "pending",
      check: "variants_status IN ('pending', 'processing', 'ready', 'failed')",
    },
    // Populated by the variant job. Shape:
    //   [{ name: "thumbnail" | "sm" | "md" | "lg" | "2x",
    //      format: "webp" | "jpg",
    //      width: int, height: int,
    //      url: text }]
    variants: { type: "jsonb" },
    original_bytes: { type: "bigint" },
    width: { type: "integer" },
    height: { type: "integer" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    processed_at: { type: "timestamptz" },
    archived_at: { type: "timestamptz" },
    last_error: { type: "text" },
  });

  // Per-site listing in the admin UI sorts by upload time descending.
  pgm.createIndex("media_assets", ["site_id", "created_at"], {
    name: "media_assets_site_created_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("media_assets");
};
