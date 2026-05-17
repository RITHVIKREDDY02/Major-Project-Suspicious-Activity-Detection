import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const monitorsTable = pgTable("monitors", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  streamUrl: text("stream_url").notNull(),
  whatsappNumber: text("whatsapp_number").notNull(),
  status: text("status").notNull().default("stopped"),
  intervalSeconds: integer("interval_seconds").notNull().default(30),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMonitorSchema = createInsertSchema(monitorsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMonitor = z.infer<typeof insertMonitorSchema>;
export type Monitor = typeof monitorsTable.$inferSelect;
