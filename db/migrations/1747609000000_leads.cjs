/* eslint-disable camelcase */

// D700 (W1.6 of the 2026-07-30 product-audit remediation).
//
// Every template shipped a crm_form posting into the void (`/api/leads`,
// `/reservations`, fictional form domains) — no lead-capture route existed
// anywhere. This table is the storage half of the ONE real platform lead
// endpoint (`POST /api/leads`, host-resolved on the tenant origin exactly
// like page rendering — src/server/routes/leads.ts).
//
// `fields` is the submitted form body as-is (minus meta/honeypot keys) —
// templates author arbitrary field names (name/phone/party_size/…), so a
// JSONB bag is the honest shape. `page_hint` records where on the site the
// form was submitted (hidden `_page` input, else Referer path). A manage
// surface listing these is W2 scope; the data lands safely now.

exports.up = (pgm) => {
  pgm.createTable("leads", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    site_id: {
      type: "uuid",
      notNull: true,
      references: "sites",
      onDelete: "CASCADE",
    },
    page_hint: { type: "text" },
    fields: { type: "jsonb", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  // The eventual manage surface lists a site's leads newest-first.
  pgm.createIndex("leads", ["site_id", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("leads");
};
