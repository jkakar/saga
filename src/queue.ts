import { sleep } from "@blaide/timing.server";
import config from "~/config.server";
import type { Notifier, Store, Workflow, WorkflowExecutor } from "./executor";

export class WorkflowQueue {
  private executions = new Set<string>();
  private running = false;

  constructor(
    private store: Store,
    private executor: WorkflowExecutor,
    private notifier?: Notifier,
  ) {
    this.store = store;
    this.executor = executor;
    this.notifier = notifier;
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
          config.logger.info(
            {
              limit,
              queryBackoffMilliseconds,
              currentExecutionCount: this.executions.size,
              newExecutionCount: workflows.length,
              ids: workflows.map((w) => w.id).sort(),
            },
            "executing queued workflows",
          );
        }
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.executeMany(workflows, this.notifier);
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

  async executeMany(workflows: Workflow[], notifier?: Notifier): Promise<void> {
    for (const workflow of workflows) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.execute(workflow, notifier);
    }
  }

  private async execute(
    workflow: Workflow,
    notifier?: Notifier,
  ): Promise<void> {
    this.executions.add(workflow.id);
    try {
      await this.executor.execute(workflow, notifier);
    } catch (err) {
      config.logger.error({ err }, "workflow execution error");
    } finally {
      this.executions.delete(workflow.id);
    }
  }
}
