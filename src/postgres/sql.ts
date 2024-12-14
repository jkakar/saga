import { and, between, eq, inArray, lt, lte } from "drizzle-orm";
import { db } from "./database";
import { activities, workflowLocks, workflows } from "./schema";
import type { Activity, Workflow, WorkflowLock } from "./schema";

export async function insertWorkflowLock(
  lock: WorkflowLock,
): Promise<WorkflowLock> {
  try {
    const result = await db.insert(workflowLocks).values(lock).returning();
    if (!result) {
      throw new Error(
        `got undefined result inserting workflow lock ${lock.id}`,
      );
    }
    return result[0];
  } catch (err) {
    if (isPgError(err) && err.code === "23505") {
      throw new Error(`workflow workflow-type already locked (${lock.id})`);
    }
    throw err;
  }
}

export async function selectWorkflowLock(
  id: string,
): Promise<WorkflowLock | undefined> {
  return await db.query.workflowLocks.findFirst({
    where: eq(workflowLocks.id, id),
  });
}

export async function deleteWorkflowLock(id: string) {
  return await db.delete(workflowLocks).where(eq(workflowLocks.id, id));
}

export async function insertWorkflow(workflow: Workflow): Promise<Workflow> {
  const result = await db.insert(workflows).values(workflow).returning();
  if (!result) {
    throw new Error(`got undefined result inserting workflow ${workflow}`);
  }
  return result[0];
}

export async function selectWorkflowById(
  id: string,
): Promise<Workflow | undefined> {
  return await db.query.workflows.findFirst({
    where: eq(workflows.id, id),
  });
}

export async function selectWorkflowByRefId(
  id: string,
): Promise<Workflow | undefined> {
  return await db.query.workflows.findFirst({
    where: eq(workflows.refId, id),
  });
}

export async function updateWorkflow(
  id: string,
  updates: Partial<Workflow>,
): Promise<Workflow | undefined> {
  updates.updatedAt = new Date();
  const [workflow] = await db
    .update(workflows)
    .set(updates)
    .where(eq(workflows.id, id))
    .returning();
  return workflow;
}

export async function selectExecutableWorkflows(cutoff: Date, limit: number) {
  return await db.transaction(async (tx) => {
    const executables = await tx
      .select()
      .from(workflows)
      .where(
        and(lte(workflows.executeAt, cutoff), eq(workflows.state, "queued")),
      )
      .for("update", { skipLocked: true })
      .limit(limit);
    for (const workflow of executables) {
      workflow.updatedAt = new Date();
      workflow.state = "pending";
      await tx
        .update(workflows)
        .set(workflow)
        .where(eq(workflows.id, workflow.id));
    }
    return executables;
  });
}

export async function selectLostWorkflows(
  lookback: number,
  cutoff: number,
  limit: number,
) {
  const now = new Date();
  const start = new Date(now.getTime() - lookback);
  const end = new Date(now.getTime() - cutoff);

  return await db.query.workflows.findMany({
    where: and(
      inArray(workflows.state, [
        "pending",
        "running",
        "running_retry",
        "running_rollback",
      ]),
      between(workflows.createdAt, start, end),
      lt(workflows.executeAt, end),
    ),
    limit: limit,
  });
}

export async function insertActivity(activity: Activity): Promise<Activity> {
  const result = await db.insert(activities).values(activity).returning();
  if (!result) {
    throw new Error(`got undefined result inserting activity ${activity}`);
  }
  return result[0];
}

export async function updateActivity(
  id: string,
  updates: Partial<Activity>,
): Promise<Activity | undefined> {
  const [activity] = await db
    .update(activities)
    .set(updates)
    .where(eq(activities.id, id))
    .returning();
  return activity;
}

export async function selectActivityByWorkflowIdAndType(
  id: string,
  type: string,
): Promise<Activity | undefined> {
  return await db.query.activities.findFirst({
    where: and(eq(activities.workflowId, id), eq(activities.type, type)),
  });
}

// biome-ignore lint: unexpected any
function isPgError(error: any): error is { code: string; detail?: string } {
  return error && typeof error.code === "string";
}
