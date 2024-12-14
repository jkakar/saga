import { v4 as uuidv4 } from "uuid";
import { describe, expect, test } from "vitest";
import { WorkflowExecutor } from "./executor";
import { WorkflowGC } from "./gc";
import { MemoryStore } from "./memory/store";
import { PostgresStore } from "./postgres/store";
import { PluginRegistry } from "./registry";
import { type Store, WorkflowState } from "./types";

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
    describe(`WorkflowGC.collectMany with ${tc.name}`, () => {
      test("is a no-op if no workflows are provided", async () => {
        const gc = new WorkflowGC(tc.store());
        await gc.collectMany([]);
      });

      test("transitions workflows to the 'queued' state and sets 'execute_at' times to now", async () => {
        const store = tc.store();
        const gc = new WorkflowGC(store);
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
        expect(workflow.executeAt).toBeNull();
        expect(workflow.state).toBe(WorkflowState.Pending);
        await gc.collectMany([workflow]);
        expect(workflow.executeAt).toBeDefined();
        expect(workflow.state).toBe(WorkflowState.Queued);
      });
    });
  }
});
