/* eslint-disable camelcase */

// AI site agent (post-v1 — spec docs/superpowers/specs/2026-07-27-ai-site-agent-design.md).
// Conversations are site-scoped; messages store raw Anthropic content-block
// arrays so tool_use/tool_result replay losslessly when rebuilding model context.
//
// NOTE: unlike pages/posts, ai_conversations does NOT use the shared
// touch_updated_at trigger. `updated_at` here means "last message activity"
// (repo.ts bumps it explicitly in appendMessage) so listConversations' "most
// recently active" ordering isn't perturbed by incidental metadata edits
// (e.g. setConversationStatus) the way a blanket BEFORE UPDATE trigger would.

exports.up = (pgm) => {
  pgm.createTable("ai_conversations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    site_id: { type: "uuid", notNull: true, references: '"sites"', onDelete: "CASCADE" },
    title: { type: "text", notNull: true, default: "New conversation" },
    status: {
      type: "text", notNull: true, default: "active",
      check: "status IN ('active','error','archived')",
    },
    token_usage: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("ai_conversations", ["site_id", "updated_at"], { name: "ai_conversations_site_idx" });

  pgm.createTable("ai_messages", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    conversation_id: {
      type: "uuid", notNull: true, references: '"ai_conversations"', onDelete: "CASCADE",
    },
    role: { type: "text", notNull: true, check: "role IN ('user','assistant','tool')" },
    content: { type: "jsonb", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("ai_messages", ["conversation_id", "created_at", "id"], { name: "ai_messages_conv_idx" });
};

exports.down = (pgm) => {
  pgm.dropTable("ai_messages");
  pgm.dropTable("ai_conversations");
};
