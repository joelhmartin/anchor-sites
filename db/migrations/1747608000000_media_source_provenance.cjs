/* eslint-disable camelcase */

// W1.5 / D1117 — image import provenance + dedupe.
//
// `ingestImageFromUrl` (AI agent import_image, src/server/media/ingest.ts)
// previously persisted neither the source URL nor the photographer credit
// `search_stock_images` returned — attribution/provenance were
// unrecoverable — and re-run/resumed builds re-imported the same Pixabay
// hit as a brand-new asset every time.
//
//  - source_url: the exact https URL the asset was downloaded from
//    (NULL for browser signed-URL uploads, which have no source URL).
//  - credit: free-text attribution (e.g. the Pixabay photographer name).
//
// The (site_id, source_url) index backs the dedupe lookup in
// `ingestImageFromUrl` — a SELECT short-circuit, deliberately NOT a unique
// constraint: concurrent same-URL imports inside one build racing an insert
// error would be worse than an occasional duplicate row, and archived rows
// must not block a fresh re-import.

exports.up = (pgm) => {
  pgm.addColumns("media_assets", {
    source_url: { type: "text" },
    credit: { type: "text" },
  });

  pgm.createIndex("media_assets", ["site_id", "source_url"], {
    name: "media_assets_site_source_url_idx",
    where: "source_url IS NOT NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("media_assets", ["site_id", "source_url"], {
    name: "media_assets_site_source_url_idx",
  });
  pgm.dropColumns("media_assets", ["source_url", "credit"]);
};
