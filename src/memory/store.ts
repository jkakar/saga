import {
  type Activity,
  ActivityState,
  type Store,
  type Workflow,
  type WorkflowInput,
  WorkflowState,
} from "../executor";

export class MemoryStore implements Store {
  protected cache = new Map<
    string, // workflow.id
    { workflow: Workflow; activities: Activity[] }
  >();
  protected locks = new Set<string>(); // workflow.id

  async getWorkflowById(id: string): Promise<Workflow | undefined> {
    for (const entry of this.cache.values()) {
      if (entry.workflow.id === id) {
        return entry.workflow;
      }
    }
    return undefined;
  }

  async getWorkflowByRefId(id: string): Promise<Workflow | undefined> {
    for (const entry of this.cache.values()) {
      if (entry.workflow.refId === id) {
        return entry.workflow;
      }
    }
    return undefined;
  }

  async getExecutableWorkflows(
    cutoff: Date,
    limit: number,
  ): Promise<Workflow[]> {
    const workflows: Workflow[] = [];
    for (const entry of this.cache.values()) {
      if (
        workflows.length < limit &&
        entry.workflow.state === WorkflowState.Queued &&
        entry.workflow.executeAt &&
        entry.workflow.executeAt < cutoff
      ) {
        workflows.push(entry.workflow);
      }
    }
    return workflows;
  }

  async getLostWorkflows(limit: number): Promise<Workflow[]> {
    const workflows: Workflow[] = [];
    for (const entry of this.cache.values()) {
      if (
        workflows.length < limit &&
        (entry.workflow.state === WorkflowState.Pending ||
          entry.workflow.state === WorkflowState.Running ||
          entry.workflow.state === WorkflowState.RunningRetry ||
          entry.workflow.state === WorkflowState.RunningRollback) &&
        entry.workflow.updatedAt <
          new Date(
            new Date().getTime() - 10 * 60 * 1000, // 10 minutes
          )
      ) {
        workflows.push(entry.workflow);
      }
    }
    return workflows;
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
    this.cache.set(workflow.id, { workflow: workflow, activities: [] });
    return workflow;
  }

  async updateWorkflow(workflow: Workflow): Promise<void> {
    workflow.updatedAt = new Date();
  }

  async lockWorkflow(workflow: Workflow): Promise<void> {
    if (this.locks.has(workflow.id)) {
      throw `workflow ${workflow.type} already locked (${workflow.id})`;
    }
    this.locks.add(workflow.id);
  }

  async tryLockWorkflow(workflow: Workflow): Promise<boolean> {
    if (!this.locks.has(workflow.id)) {
      await this.lockWorkflow(workflow);
      return true;
    }
    return false;
  }

  async unlockWorkflow(workflow: Workflow): Promise<void> {
    this.locks.delete(workflow.id);
  }

  async setWorkflowState(
    workflow: Workflow,
    state: WorkflowState,
  ): Promise<void> {
    workflow.state = state;
    if (state === WorkflowState.Running) {
      workflow.attempts += 1;
    }
    workflow.updatedAt = new Date();
  }

  async getActivityByType(
    workflow: Workflow,
    activityType: string,
  ): Promise<Activity | undefined> {
    const entry = this.cache.get(workflow.id);
    if (entry) {
      for (const activity of entry.activities) {
        if (activity.type === activityType) {
          return activity;
        }
      }
    }
    return undefined;
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
    const entry = this.cache.get(workflow.id);
    if (!entry) {
      throw `unknown workflow ${workflow.type} (${workflow.id})`;
    }
    entry.activities.push(activity);
    return activity;
  }

  async updateActivity(activity: Activity): Promise<void> {
    activity.updatedAt = new Date();
  }
}
