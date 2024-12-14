import type { WorkflowExecutor } from "./executor";
import { sleep } from "./timing";
import type { Store, Workflow } from "./types";

export class WorkflowQueue {
  private executions = new Set<string>();
  private running = false;

  constructor(
    private store: Store,
    private executor: WorkflowExecutor,
  ) {
    this.store = store;
    this.executor = executor;
  }

  async run(limit: number, queryBackoffMilliseconds: number): Promise<void> {
    this.running = true;
    while (this.running) {
      if (this.executions.size < limit) {
        const now = new Date();
        const workflows = await this.store.getExecutableWorkflows(
          now,
          limit - this.executions.size,
        );
        if (workflows.length > 0) {
          console.log("executing queued workflows", {
            limit,
            queryBackoffMilliseconds,
            currentExecutionCount: this.executions.size,
            newExecutionCount: workflows.length,
            ids: workflows.map((w) => w.id).sort(),
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.executeMany(workflows);
      }
      await sleep(queryBackoffMilliseconds);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.executions.size === 0) {
        break;
      }
      await sleep(500);
    }
  }

  async executeMany(workflows: Workflow[]): Promise<void> {
    for (const workflow of workflows) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.execute(workflow);
    }
  }

  private async execute(workflow: Workflow): Promise<void> {
    this.executions.add(workflow.id);
    try {
      await this.executor.execute(workflow);
    } catch (err) {
      console.error("workflow execution error", err);
    } finally {
      this.executions.delete(workflow.id);
    }
  }
}
