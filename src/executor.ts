import { v5 as uuidv5 } from "uuid";
import type { PluginRegistry } from "./registry";
import {
  type Activity,
  type ActivityPlugin,
  ActivityState,
  type Store,
  type Workflow,
  type WorkflowInput,
  type WorkflowPlugin,
  WorkflowState,
} from "./types";

export type ActivityCallback = (
  workflow: Workflow,
  activity: Activity,
) => Promise<void>;

function generateActivityId(workflowId: string, activityType: string): string {
  // The hard-coded namespace UUID here must never be changed.
  //
  // Activity IDs are a v5 UUID based on the workflow ID, the activity type, and
  // this namespace. This behavior ensures that generated activity IDs are
  // stable, which in turn ensures that activity creation is idempotent.
  return uuidv5(
    `${workflowId}:${activityType}`,
    "5df6a4fe-1fe4-47b8-bf32-3bf599650a9f",
  );
}

class ActivityExecutor {
  constructor(
    private store: Store,
    private activities: PluginRegistry<ActivityPlugin>,
  ) {
    this.store = store;
    this.activities = activities;
  }

  async create(workflow: Workflow, activityType: string): Promise<Activity> {
    const activity = await this.store.getActivityByType(workflow, activityType);
    if (!activity) {
      const id = generateActivityId(workflow.id, activityType);
      return await this.store.createActivity(workflow, id, activityType);
    }
    return activity;
  }

  async execute(workflow: Workflow, activity: Activity): Promise<void> {
    await this.invoke("execute", workflow, activity);
  }

  async rollback(workflow: Workflow, activity: Activity): Promise<void> {
    await this.invoke("rollback", workflow, activity);
  }

  private async invoke(
    operation: "execute" | "rollback",
    workflow: Workflow,
    activity: Activity,
  ): Promise<void> {
    const plugin = this.activities.lookup(
      activity.type.replace("rollback:", "").split(":", 1)[0],
    );

    if (!plugin) {
      throw `unknown activity plugin: ${activity.type}`;
    }

    if (!this.isActivityTerminal(activity)) {
      activity.state = ActivityState.Pending;
      await this.store.updateActivity(activity);
    }

    const callback =
      operation === "execute"
        ? plugin.execute.bind(plugin)
        : plugin.rollback.bind(plugin);
    await this.converge(workflow, activity, callback);
  }

  private async converge(
    workflow: Workflow,
    activity: Activity,
    callback: ActivityCallback,
  ): Promise<void> {
    switch (activity.state) {
      case ActivityState.Pending:
        await this.handlePending(workflow, activity);
        await this.converge(workflow, activity, callback);
        return;
      case ActivityState.Running:
        await this.handleRunning(workflow, activity, callback);
        await this.converge(workflow, activity, callback);
        return;
    }
  }

  private async handlePending(_: Workflow, activity: Activity): Promise<void> {
    activity.state = ActivityState.Running;
    await this.store.updateActivity(activity);
  }

  private async handleRunning(
    workflow: Workflow,
    activity: Activity,
    callback: ActivityCallback,
  ): Promise<void> {
    try {
      console.log("starting activity plugin", {
        workflowId: workflow.id,
        workflowType: workflow.type,
        workflowState: workflow.state,
        refId: workflow.refId,
        refType: workflow.refType,
        workflowAttempts: workflow.attempts,
        activityTypes: workflow.activityTypes,
        activityId: activity.id,
        activityType: activity.type,
        activityState: activity.state,
      });
      await callback(workflow, activity);
    } catch (err) {
      activity.state = ActivityState.FailedTemporary;
      if (err === ActivityState.FailedPermanent) {
        activity.state = ActivityState.FailedPermanent;
      }
      console.error("activity plugin error", {
        err,
        workflowId: workflow.id,
        workflowType: workflow.type,
        workflowState: workflow.state,
        refId: workflow.refId,
        refType: workflow.refType,
        workflowAttempts: workflow.attempts,
        activityTypes: workflow.activityTypes,
        activityId: activity.id,
        activityType: activity.type,
        activityState: activity.state,
      });
      await this.store.updateActivity(activity);
      return;
    }
    console.log("finished activity plugin", {
      workflowId: workflow.id,
      workflowType: workflow.type,
      workflowState: workflow.state,
      refId: workflow.refId,
      refType: workflow.refType,
      workflowAttempts: workflow.attempts,
      activityTypes: workflow.activityTypes,
      activityId: activity.id,
      activityType: activity.type,
      activityState: activity.state,
    });
    activity.state = ActivityState.Succeeded;
    await this.store.updateActivity(activity);
  }

  private isActivityTerminal(activity: Activity): boolean {
    return (
      activity.state === ActivityState.FailedPermanent ||
      activity.state === ActivityState.Succeeded
    );
  }
}

export class WorkflowExecutor {
  private executor: ActivityExecutor;

  constructor(
    private store: Store,
    private workflows: PluginRegistry<WorkflowPlugin>,
    private activities: PluginRegistry<ActivityPlugin>,
    private retryBackoffMilliseconds: number = 10 * 1000, // 10 seconds
  ) {
    this.activities = activities;
    this.executor = new ActivityExecutor(store, this.activities);
    this.workflows = workflows;
    this.retryBackoffMilliseconds = retryBackoffMilliseconds;
  }

  async create(input: WorkflowInput): Promise<Workflow> {
    console.log("creating workflow", input);
    return this.store.createWorkflow(input);
  }

  async execute(workflow: Workflow): Promise<void> {
    console.log("starting workflow", {
      id: workflow.id,
      type: workflow.type,
      state: workflow.state,
      refId: workflow.refId,
      refType: workflow.refType,
      attempts: workflow.attempts,
      activityTypes: workflow.activityTypes,
    });
    await this.store.lockWorkflow(workflow);
    try {
      await this.converge(workflow);
    } finally {
      await this.store.unlockWorkflow(workflow);
    }
    console.log("finished workflow", {
      id: workflow.id,
      type: workflow.type,
      state: workflow.state,
      refId: workflow.refId,
      refType: workflow.refType,
      attempts: workflow.attempts,
      activityTypes: workflow.activityTypes,
      durationSeconds:
        (new Date().getTime() - workflow.createdAt.getTime()) / 1000,
    });
  }

  private async converge(workflow: Workflow): Promise<void> {
    console.debug("converging workflow", {
      id: workflow.id,
      type: workflow.type,
      state: workflow.state,
      refId: workflow.refId,
      refType: workflow.refType,
      attempts: workflow.attempts,
      activityTypes: workflow.activityTypes,
    });
    switch (workflow.state) {
      case WorkflowState.Queued:
        throw "unexpected workflow state";
      case WorkflowState.Pending:
        await this.handlePending(workflow);
        await this.converge(workflow);
        return;
      case WorkflowState.Running:
        await this.handleRunning(workflow);
        await this.converge(workflow);
        return;
      case WorkflowState.RunningRetry:
        await this.handleRunningRetry(workflow);
        return;
      case WorkflowState.RunningRollback:
        await this.handleRunningRollback(workflow);
        await this.converge(workflow);
        return;
    }
  }

  private async handlePending(workflow: Workflow): Promise<void> {
    if (workflow.activityTypes.length === 0) {
      const plugin = this.workflows.lookup(workflow.type.split(":", 1)[0]);
      if (!plugin) {
        throw `unknown workflow plugin: ${workflow.type}`;
      }
      const activityTypes = await plugin.plan(workflow);
      if (activityTypes.length === 0) {
        await this.store.setWorkflowState(workflow, WorkflowState.Failed);
        return;
      }
      workflow.activityTypes = activityTypes;
      await this.store.updateWorkflow(workflow);
    }
    console.log("planned workflow", {
      id: workflow.id,
      type: workflow.type,
      state: workflow.state,
      refId: workflow.refId,
      refType: workflow.refType,
      attempts: workflow.attempts,
      activityTypes: workflow.activityTypes,
    });
    await this.store.setWorkflowState(workflow, WorkflowState.Running);
  }

  private async handleRunning(workflow: Workflow): Promise<void> {
    for (const activityType of workflow.activityTypes) {
      const activity = await this.executor.create(workflow, activityType);
      await this.executor.execute(workflow, activity);
      switch (activity.state) {
        case ActivityState.FailedPermanent:
          await this.store.setWorkflowState(
            workflow,
            WorkflowState.RunningRollback,
          );
          return;
        case ActivityState.FailedTemporary:
          await this.store.setWorkflowState(
            workflow,
            WorkflowState.RunningRetry,
          );
          return;
      }
    }
    await this.store.setWorkflowState(workflow, WorkflowState.Succeeded);
  }

  private async handleRunningRetry(workflow: Workflow): Promise<void> {
    workflow.executeAt = new Date(
      new Date().getTime() + this.retryBackoffMilliseconds,
    );
    await this.store.setWorkflowState(workflow, WorkflowState.Queued);
    await this.store.updateWorkflow(workflow);
  }

  private async handleRunningRollback(workflow: Workflow): Promise<void> {
    const reversedActivityTypes = [...workflow.activityTypes].reverse();
    for (const activityType of reversedActivityTypes) {
      const activity = await this.store.getActivityByType(
        workflow,
        activityType,
      );
      if (!activity) {
        throw `missing activity ${activityType} for workflow ${workflow.type} (${workflow.id})`;
      }
      if (activity.state !== ActivityState.Succeeded) {
        continue;
      }

      const rollbackActivityType = `rollback:${activityType}`;
      const rollbackActivity = await this.executor.create(
        workflow,
        rollbackActivityType,
      );
      await this.executor.rollback(workflow, rollbackActivity);
      switch (rollbackActivity.state) {
        case ActivityState.FailedPermanent:
          await this.store.setWorkflowState(
            workflow,
            WorkflowState.FailedRollback,
          );
          return;
        case ActivityState.FailedTemporary:
          await this.store.setWorkflowState(
            workflow,
            WorkflowState.RunningRetry,
          );
          return;
      }
    }
    await this.store.setWorkflowState(workflow, WorkflowState.Failed);
  }
}
