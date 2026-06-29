/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = function (pgm) {
  pgm.addColumns("sites", {
    ctm_account_id: { type: "text", notNull: false },
    crm_site_id: { type: "text", notNull: false },
  });
};

exports.down = function (pgm) {
  pgm.dropColumns("sites", ["ctm_account_id", "crm_site_id"]);
};
