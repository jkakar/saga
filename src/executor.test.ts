import { v4 as uuidv4 } from "uuid";
import { describe, expect, test } from "vitest";
import { WorkflowExecutor } from "./executor";
import { MemoryStore } from "./memory/store";
import { PostgresStore } from "./postgres/store";
import { PluginRegistry } from "./registry";
import { FakeActivityPlugin, FakeWorkflowPlugin } from "./testing";
import {
  type Activity,
  type ActivityPlugin,
  ActivityState,
  type Store,
  type Workflow,
  type WorkflowPlugin,
  WorkflowState,
} from "./types";

describe("PluginRegistry.register", () => {
  test("is compatible with WorkflowPlugin values", () => {
    const registry = new PluginRegistry();
    const workflowType = "workflow-type";
    const plugin = new FakeWorkflowPlugin({ type: workflowType });
    expect(registry.lookup(workflowType)).toBeUndefined();
    registry.register(plugin);
    expect(registry.lookup(workflowType)).toBe(plugin);
  });

  test("is compatible with ActivityPlugin values", () => {
    const registry = new PluginRegistry();
    const activityType = "activity-type";
    const plugin = new FakeActivityPlugin({ type: activityType });
    expect(registry.lookup(activityType)).toBeUndefined();
    registry.register(plugin);
    expect(registry.lookup(activityType)).toBe(plugin);
  });
});

describe("Store", async () => {
  const cases: Array<{
    name: string;
    store: () => Store;
  }> = [
    {
      name: "MemoryStore",
      store: () => new MemoryStore(),
    },
    {
      name: "PostgresStore",
      store: () => new PostgresStore(),
    },
  ];

  for (const tc of cases) {
    describe(`${tc.name}.lockWorkflow`, async () => {
      test("takes a lock", async () => {
        const store = tc.store();
        const executor = new WorkflowExecutor(
          store,
          new PluginRegistry(),
          new PluginRegistry(),
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await store.lockWorkflow(workflow);
        expect(await store.tryLockWorkflow(workflow)).toBeFalsy();
      });

      test("throws an exception if the workflow is already locked", async () => {
        const store = tc.store();
        const executor = new WorkflowExecutor(
          store,
          new PluginRegistry(),
          new PluginRegistry(),
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await store.lockWorkflow(workflow);
        await expect(async () => {
          await store.lockWorkflow(workflow);
        }).rejects.toThrow(
          `workflow workflow-type already locked (${workflow.id})`,
        );
      });
    });

    describe(`${tc.name}.tryLockWorkflow`, async () => {
      test("takes a lock", async () => {
        const store = tc.store();
        const executor = new WorkflowExecutor(
          store,
          new PluginRegistry(),
          new PluginRegistry(),
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        expect(await store.tryLockWorkflow(workflow)).toBeTruthy();
        expect(await store.tryLockWorkflow(workflow)).toBeFalsy();
        await store.unlockWorkflow(workflow);
        expect(await store.tryLockWorkflow(workflow)).toBeTruthy();
      });
    });

    describe(`WorkflowExecutor.create with ${tc.name}`, async () => {
      test("creates a workflow in a 'pending' state", async () => {
        const executor = new WorkflowExecutor(
          tc.store(),
          new PluginRegistry(),
          new PluginRegistry(),
        );
        const id = uuidv4();
        const refId = uuidv4();
        const workflow = await executor.create({
          id: id,
          type: "workflow-type",
          refType: "ref-type",
          refId: refId,
        });
        expect(workflow.id).toBe(id);
        expect(workflow.type).toBe("workflow-type");
        expect(workflow.state).toBe(WorkflowState.Pending);
        expect(workflow.refType).toBe("ref-type");
        expect(workflow.refId).toBe(refId);
        expect(workflow.activityTypes).toEqual([]);
        expect(workflow.attempts).toBe(0);
        expect(workflow.executeAt).toBeNull();
        expect(workflow.createdAt).toBeDefined();
        expect(workflow.updatedAt).toBeDefined();
      });

      test("creates a workflow in a 'queued' state when 'execute_at' is defined", async () => {
        const executor = new WorkflowExecutor(
          tc.store(),
          new PluginRegistry(),
          new PluginRegistry(),
        );
        const id = uuidv4();
        const refId = uuidv4();
        const executeAt = new Date();
        const workflow = await executor.create({
          id: id,
          type: "workflow-type",
          refType: "ref-type",
          refId: refId,
          executeAt: executeAt,
        });
        expect(workflow.id).toBe(id);
        expect(workflow.type).toBe("workflow-type");
        expect(workflow.state).toBe(WorkflowState.Queued);
        expect(workflow.refType).toBe("ref-type");
        expect(workflow.refId).toBe(refId);
        expect(workflow.activityTypes).toEqual([]);
        expect(workflow.attempts).toBe(0);
        expect(workflow.executeAt).toEqual(executeAt);
        expect(workflow.createdAt).toBeDefined();
        expect(workflow.updatedAt).toBeDefined();
      });
    });

    describe(`WorkflowExecutor.execute with ${tc.name}`, async () => {
      test("throws an exception if a workflow has an unknown type", async () => {
        const executor = new WorkflowExecutor(
          tc.store(),
          new PluginRegistry(),
          new PluginRegistry(),
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "unknown-workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await expect(
          async () => await executor.execute(workflow),
        ).rejects.toThrow("unknown workflow plugin: unknown-workflow-type");
      });

      test("throws an exception if a workflow is in a 'queued' state", async () => {
        const store = tc.store();
        const executor = new WorkflowExecutor(
          store,
          new PluginRegistry(),
          new PluginRegistry(),
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "unknown-workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await store.setWorkflowState(workflow, WorkflowState.Queued);
        await expect(
          async () => await executor.execute(workflow),
        ).rejects.toThrow("unexpected workflow state");
      });

      test("transitions a workflow to the 'failed' state when no activites are provided", async () => {
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(new FakeWorkflowPlugin({ type: "workflow-type" }));
        const executor = new WorkflowExecutor(
          tc.store(),
          workflows,
          new PluginRegistry(),
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        expect(workflow.state).toBe(WorkflowState.Pending);
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.Failed);
      });

      test("throws an exception if a workflow defines an unknown activity type", async () => {
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: ["unknown-activity-type"],
          }),
        );
        const executor = new WorkflowExecutor(
          tc.store(),
          workflows,
          new PluginRegistry(),
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await expect(
          async () => await executor.execute(workflow),
        ).rejects.toThrow("unknown activity plugin: unknown-activity-type");
        expect(workflow.state).toBe(WorkflowState.Running);
      });

      test("executes a workflow with a single activity", async () => {
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: ["activity-type"],
          }),
        );
        const activity = new FakeActivityPlugin({ type: "activity-type" });
        const activities = new PluginRegistry<ActivityPlugin>();
        activities.register(activity);
        const executor = new WorkflowExecutor(
          tc.store(),
          workflows,
          activities,
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.Succeeded);
        expect(activity.executeCalled).toBe(1);
      });

      test("executes a workflow with a single activity that has colon-separated metadata in the workflow type", async () => {
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: ["activity-type"],
          }),
        );
        const activityPlugin = new FakeActivityPlugin({
          type: "activity-type",
        });
        const activities = new PluginRegistry<ActivityPlugin>();
        activities.register(activityPlugin);
        const store = tc.store();
        const executor = new WorkflowExecutor(store, workflows, activities);
        const workflow = await executor.create({
          id: uuidv4(),
          type: `workflow-type:${uuidv4()}`,
          refType: "ref-type",
          refId: uuidv4(),
        });
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.Succeeded);
        expect(activityPlugin.executeCalled).toBe(1);
      });

      test("executes a workflow with a single activity that has colon-separated metadata in the activity type", async () => {
        const workflows = new PluginRegistry<WorkflowPlugin>();
        const activityType = `activity-type:${uuidv4()}`;
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: [activityType],
          }),
        );
        const activityPlugin = new FakeActivityPlugin({
          type: "activity-type",
        });
        const activities = new PluginRegistry<ActivityPlugin>();
        activities.register(activityPlugin);
        const store = tc.store();
        const executor = new WorkflowExecutor(store, workflows, activities);
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.Succeeded);
        expect(activityPlugin.executeCalled).toBe(1);

        const activity = await store.getActivityByType(workflow, activityType);
        expect(activity?.type).toBe(activityType);
      });

      test("executes a workflow with multiple activities in order", async () => {
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: ["activity-type-1", "activity-type-2"],
          }),
        );
        const history: string[] = [];
        const activity1 = new FakeActivityPlugin({ type: "activity-type-1" });
        activity1.executeFunc = async (
          _workflow: Workflow,
          activity: Activity,
        ): Promise<void> => {
          history.push(activity.type);
        };
        const activity2 = new FakeActivityPlugin({ type: "activity-type-2" });
        activity2.executeFunc = async (
          _workflow: Workflow,
          activity: Activity,
        ): Promise<void> => {
          history.push(activity.type);
        };
        const activities = new PluginRegistry<ActivityPlugin>();
        activities.register(activity1);
        activities.register(activity2);
        const executor = new WorkflowExecutor(
          tc.store(),
          workflows,
          activities,
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.Succeeded);
        expect(activity1.executeCalled).toBe(1);
        expect(activity2.executeCalled).toBe(1);
        expect(history).toEqual(["activity-type-1", "activity-type-2"]);
      });

      test("schedules a retry when an activity has a temporary failure", async () => {
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: ["activity-type"],
          }),
        );
        const activities = new PluginRegistry<ActivityPlugin>();
        const activity = new FakeActivityPlugin({
          type: "activity-type",
          executeFunc: async (
            _workflow: Workflow,
            _activity: Activity,
          ): Promise<void> => {
            throw "temporary failure";
          },
        });
        activities.register(activity);
        const executor = new WorkflowExecutor(
          tc.store(),
          workflows,
          activities,
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        expect(workflow.executeAt).toBeNull();
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.Queued);
        expect(workflow.executeAt).toBeDefined();
        expect(activity.executeCalled).toBe(1);
        expect(activity.rollbackCalled).toBe(0);
      });

      test("performs a rollback when an activity has a permanent failure", async () => {
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: ["activity-type"],
          }),
        );
        const activities = new PluginRegistry<ActivityPlugin>();
        const activity = new FakeActivityPlugin({
          type: "activity-type",
          executeFunc: async (
            _workflow: Workflow,
            _activity: Activity,
          ): Promise<void> => {
            throw ActivityState.FailedPermanent;
          },
        });
        activities.register(activity);
        const executor = new WorkflowExecutor(
          tc.store(),
          workflows,
          activities,
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.Failed);
        expect(activity.executeCalled).toBe(1);
        expect(activity.rollbackCalled).toBe(0);
      });

      test("performs a rollback of prior activities when an activity has a permanent failure", async () => {
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: ["activity-type-1", "activity-type-2"],
          }),
        );
        const activity1 = new FakeActivityPlugin({ type: "activity-type-1" });
        const activity2 = new FakeActivityPlugin({
          type: "activity-type-2",
          executeFunc: async (
            _workflow: Workflow,
            _activity: Activity,
          ): Promise<void> => {
            throw ActivityState.FailedPermanent;
          },
        });
        const activities = new PluginRegistry<ActivityPlugin>();
        activities.register(activity1);
        activities.register(activity2);
        const executor = new WorkflowExecutor(
          tc.store(),
          workflows,
          activities,
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.Failed);
        expect(activity1.executeCalled).toBe(1);
        expect(activity2.executeCalled).toBe(1);
        expect(activity2.rollbackCalled).toBe(0);
        expect(activity1.rollbackCalled).toBe(1);
      });

      test("schedules a retry when a rollback activity has a temporary failure", async () => {
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: ["activity-type-1", "activity-type-2"],
          }),
        );
        const activity1 = new FakeActivityPlugin({
          type: "activity-type-1",
          rollbackFunc: async (
            _workflow: Workflow,
            _activity: Activity,
          ): Promise<void> => {
            throw ActivityState.FailedTemporary;
          },
        });
        const activity2 = new FakeActivityPlugin({
          type: "activity-type-2",
          executeFunc: async (
            _workflow: Workflow,
            _activity: Activity,
          ): Promise<void> => {
            throw ActivityState.FailedPermanent;
          },
        });
        const activities = new PluginRegistry<ActivityPlugin>();
        activities.register(activity1);
        activities.register(activity2);
        const executor = new WorkflowExecutor(
          tc.store(),
          workflows,
          activities,
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.Queued);
        expect(activity1.executeCalled).toBe(1);
        expect(activity2.executeCalled).toBe(1);
        expect(activity2.rollbackCalled).toBe(0);
        expect(activity1.rollbackCalled).toBe(1);
      });

      test("transitions a workflow to the 'failed_rollback' state when a rollback activity has a permantnt failure", async () => {
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: ["activity-type-1", "activity-type-2"],
          }),
        );
        const activity1 = new FakeActivityPlugin({
          type: "activity-type-1",
          rollbackFunc: async (
            _workflow: Workflow,
            _activity: Activity,
          ): Promise<void> => {
            throw ActivityState.FailedPermanent;
          },
        });
        const activity2 = new FakeActivityPlugin({
          type: "activity-type-2",
          executeFunc: async (
            _workflow: Workflow,
            _activity: Activity,
          ): Promise<void> => {
            throw ActivityState.FailedPermanent;
          },
        });
        const activities = new PluginRegistry<ActivityPlugin>();
        activities.register(activity1);
        activities.register(activity2);
        const executor = new WorkflowExecutor(
          tc.store(),
          workflows,
          activities,
        );
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.FailedRollback);
        expect(activity1.executeCalled).toBe(1);
        expect(activity2.executeCalled).toBe(1);
        expect(activity2.rollbackCalled).toBe(0);
        expect(activity1.rollbackCalled).toBe(1);
      });

      test("does not execute already succeeded retries during retries", async () => {
        const store = tc.store();
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: ["activity-type-1", "activity-type-2"],
          }),
        );
        const activity1 = new FakeActivityPlugin({
          type: "activity-type-1",
        });
        const activity2 = new FakeActivityPlugin({
          type: "activity-type-2",
          executeFunc: async (
            _workflow: Workflow,
            _activity: Activity,
          ): Promise<void> => {
            throw ActivityState.FailedTemporary;
          },
        });
        const activities = new PluginRegistry<ActivityPlugin>();
        activities.register(activity1);
        activities.register(activity2);
        const executor = new WorkflowExecutor(store, workflows, activities);
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.Queued);
        expect(activity1.executeCalled).toBe(1);
        expect(activity2.executeCalled).toBe(1);

        activity2.executeFunc = undefined;
        await store.setWorkflowState(workflow, WorkflowState.Pending);
        await executor.execute(workflow);
        expect(workflow.state).toBe(WorkflowState.Succeeded);
        expect(activity1.executeCalled).toBe(1);
        expect(activity2.executeCalled).toBe(2);
      });
    });
  }
});
