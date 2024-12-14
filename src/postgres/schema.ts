import { relations, sql } from "drizzle-orm";
import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { ActivityState, WorkflowState } from "../types";

export const workflowLocks = pgTable("workflow_locks", {
  id: uuid("id").primaryKey(),
  expireAt: timestamp("expire_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const workflowState = pgEnum(
  "workflow_state",
  enumToPgEnum(WorkflowState),
);

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey(),
  type: text("type").notNull(),
  state: workflowState("state").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  activityTypes: text("activity_types").array().notNull(),
  attempts: integer("attempts").notNull(),
  executeAt: timestamp("execute_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const activityState = pgEnum(
  "activity_state",
  enumToPgEnum(ActivityState),
);

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey(),
  state: activityState("state").notNull(),
  type: text("type").notNull(),
  workflowId: uuid("workflow_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const workflowRelations = relations(workflows, ({ many }) => ({
  activities: many(activities),
}));

export type WorkflowLock = typeof workflowLocks.$inferSelect;

export const insertWorkflowLockSchema = createInsertSchema(workflowLocks);

export type Workflow = typeof workflows.$inferSelect;

export const insertWorkflowSchema = createInsertSchema(workflows);

export const activitiesRelations = relations(activities, ({ one }) => ({
  project: one(workflows, {
    fields: [activities.workflowId],
    references: [workflows.id],
  }),
}));

export type Activity = typeof activities.$inferSelect;

export const insertActivitySchema = createInsertSchema(activities);

// biome-ignore lint/suspicious/noExplicitAny:
function enumToPgEnum(T: any): [string, ...string[]] {
  // biome-ignore lint/suspicious/noExplicitAny:
  return Object.values(T).map((value: any) => `${value}`) as [
    string,
    ...string[],
  ];
}
