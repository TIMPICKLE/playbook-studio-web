import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
export const users = sqliteTable("users", { id: text("id").primaryKey(), email: text("email").notNull(), name: text("name").notNull(), createdAt: integer("created_at").notNull() });
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(), title: text("title").notNull(), ownerId: text("owner_id").notNull().references(() => users.id),
  data: text("data_json").notNull(), revision: integer("revision").notNull().default(1), updatedAt: integer("updated_at").notNull(), updatedBy: text("updated_by").notNull(), lastWriteId: text("last_write_id").notNull(),
});
export const members = sqliteTable("members", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), userId: text("user_id").notNull().references(() => users.id), role: text("role").notNull(), joinedAt: integer("joined_at").notNull(),
}, t => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("members_by_user").on(t.userId)]);
export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), tokenHash: text("token_hash").notNull(), email: text("email").notNull(), role: text("role").notNull(), createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(), status: text("status").notNull().default("pending"), acceptedBy: text("accepted_by"),
}, t => [uniqueIndex("invites_by_hash").on(t.tokenHash), index("invites_by_workspace").on(t.workspaceId)]);
export const snapshots = sqliteTable("snapshots", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), revision: integer("revision").notNull(), data: text("data_json").notNull(), createdAt: integer("created_at").notNull(), actorId: text("actor_id").notNull(),
}, t => [primaryKey({ columns: [t.workspaceId, t.revision] })]);
export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), actorId: text("actor_id").notNull(), action: text("action").notNull(), detail: text("detail").notNull(), createdAt: integer("created_at").notNull(),
}, t => [index("audit_by_workspace").on(t.workspaceId, t.createdAt)]);
