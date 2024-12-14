import {
  type Activity,
  ActivityState,
  type Store,
  type Workflow,
  type WorkflowInput,
  WorkflowState,
} from "./executor";
import {
  deleteWorkflowLock,
  insertActivity,
  insertWorkflow,
  insertWorkflowLock,
  selectActivityByWorkflowIdAndType,
  selectExecutableWorkflows,
  selectLostWorkflows,
  selectWorkflowById,
  selectWorkflowByRefId,
  selectWorkflowLock,
  updateActivity,
  updateWorkflow,
} from "./sql";

export class PostgresStore implements Store {
  async getExecutableWorkflows(
    cutoff: Date,
    limit: number,
  ): Promise<Workflow[]> {
    return await selectExecutableWorkflows(cutoff, limit);
  }

  async getWorkflowById(id: string): Promise<Workflow | undefined> {
    return await selectWorkflowById(id);
  }

  async getWorkflowByRefId(id: string): Promise<Workflow | undefined> {
    return await selectWorkflowByRefId(id);
  }

  async getLostWorkflows(limit: number): Promise<Workflow[]> {
    const lookback = Number.parseInt(
      process.env.SAGA_WORKFLOW_GC_LOOKBACK_MS ?? "5000",
    );
    const cutoff = Number.parseInt(
      process.env.SAGA_WORKFLOW_GC_CUTOFF_MS ?? "7200000",
    ); // 2 hours
    return selectLostWorkflows(lookback, cutoff, limit);
  }

  async createWorkflow(input: WorkflowInput): Promise<Workflow> {
    const state = input.executeAt
      ? WorkflowState.Queued
      : WorkflowState.Pending;
    const workflow = {
      id: input.id,
      type: input.type,
      state: state,
      refType: input.refType,
      refId: input.refId,
      activityTypes: [],
      attempts: 0,
      executeAt: input.executeAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return insertWorkflow(workflow);
  }

  async updateWorkflow(workflow: Workflow): Promise<void> {
    await updateWorkflow(workflow.id, workflow);
  }

  async lockWorkflow(workflow: Workflow): Promise<void> {
    const now = new Date();
    const expireAt = new Date(now.getTime() + 15 * 60 * 1000);
    const lock = { id: workflow.id, expireAt: expireAt, createdAt: now };
    await insertWorkflowLock(lock);
  }

  async tryLockWorkflow(workflow: Workflow): Promise<boolean> {
    if (!(await selectWorkflowLock(workflow.id))) {
      await this.lockWorkflow(workflow);
      return true;
    }
    return false;
  }

  async unlockWorkflow(workflow: Workflow): Promise<void> {
    await deleteWorkflowLock(workflow.id);
  }

  async setWorkflowState(
    workflow: Workflow,
    state: WorkflowState,
  ): Promise<void> {
    workflow.state = state;
    if (state === WorkflowState.Running) {
      workflow.attempts += 1;
    }
    await updateWorkflow(workflow.id, workflow);
  }

  async getActivityByType(
    workflow: Workflow,
    activityType: string,
  ): Promise<Activity | undefined> {
    return selectActivityByWorkflowIdAndType(workflow.id, activityType);
  }

  async createActivity(
    workflow: Workflow,
    id: string,
    activityType: string,
  ): Promise<Activity> {
    const activity = {
      id: id,
      type: activityType,
      state: ActivityState.Pending,
      workflowId: workflow.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return insertActivity(activity);
  }

  async updateActivity(activity: Activity): Promise<void> {
    await updateActivity(activity.id, activity);
  }
}
