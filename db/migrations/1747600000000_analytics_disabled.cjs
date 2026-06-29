/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = function (pgm) {
  pgm.addColumn("sites", {
    analytics_disabled: {
      type: "boolean",
      notNull: true,
      default: false,
    },
  });
};

exports.down = function (pgm) {
  pgm.dropColumn("sites", "analytics_disabled");
};
