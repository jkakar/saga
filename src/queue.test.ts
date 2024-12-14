import { v4 as uuidv4 } from "uuid";
import { describe, expect, test } from "vitest";
import {
  type ActivityPlugin,
  PluginRegistry,
  type Store,
  WorkflowExecutor,
  type WorkflowPlugin,
  WorkflowState,
} from "./executor";
import { MemoryStore } from "./memory/store";
import { PostgresStore } from "./postgres/store";
import { WorkflowQueue } from "./queue";
import { FakeActivityPlugin, FakeWorkflowPlugin } from "./testing";

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
    describe(`WorkflowQueue.executeMany with ${tc.name}`, async () => {
      test("is a no-op if no workflows are provided", async () => {
        const store = tc.store();
        const executor = new WorkflowExecutor(
          store,
          new PluginRegistry(),
          new PluginRegistry(),
        );
        const queue = new WorkflowQueue(store, executor);
        await queue.executeMany([]);
        await queue.stop();
      });

      test("executes workflows", async () => {
        const store = tc.store();
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
        const executor = new WorkflowExecutor(store, workflows, activities);
        const queue = new WorkflowQueue(store, executor);
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        expect(workflow.state).toBe(WorkflowState.Pending);
        await queue.executeMany([workflow]);
        await queue.stop();
        expect(workflow.state).toBe(WorkflowState.Succeeded);
      });

      test("traps exceptions raised by broken workflows", async () => {
        const store = tc.store();
        const workflows = new PluginRegistry<WorkflowPlugin>();
        workflows.register(
          new FakeWorkflowPlugin({
            type: "workflow-type",
            activityTypes: ["unknown-activity-type"],
          }),
        );
        const activities = new PluginRegistry<ActivityPlugin>();
        const executor = new WorkflowExecutor(store, workflows, activities);
        const queue = new WorkflowQueue(store, executor);
        const workflow = await executor.create({
          id: uuidv4(),
          type: "workflow-type",
          refType: "ref-type",
          refId: uuidv4(),
        });
        expect(workflow.state).toBe(WorkflowState.Pending);
        await queue.executeMany([workflow]);
        await queue.stop();
        expect(workflow.state).toBe(WorkflowState.Running);
      });
    });
  }
});
