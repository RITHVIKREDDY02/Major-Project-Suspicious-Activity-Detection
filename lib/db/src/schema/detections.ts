import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const detectionsTable = pgTable("detections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  inputType: text("input_type").notNull().default("image"),
  inputUrl: text("input_url"),
  inputFilename: text("input_filename"),
  activityType: text("activity_type"),
  confidence: real("confidence"),
  status: text("status").notNull().default("pending"),
  boundingBoxes: text("bounding_boxes"),
  processedImageUrl: text("processed_image_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDetectionSchema = createInsertSchema(detectionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDetection = z.infer<typeof insertDetectionSchema>;
export type Detection = typeof detectionsTable.$inferSelect;
