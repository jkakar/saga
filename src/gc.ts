import { type Store, type Workflow, WorkflowState } from "./executor";
import { sleep } from "./timing";

export class WorkflowGC {
  private running = false;

  constructor(private store: Store) {
    this.store = store;
  }

  async run(limit: number, queryBackoffMilliseconds: number): Promise<void> {
    this.running = true;
    while (this.running) {
      const workflows = await this.store.getLostWorkflows(limit);
      await this.collectMany(workflows);
      await sleep(queryBackoffMilliseconds);
    }
  }

  stop(): void {
    this.running = false;
  }

  async collectMany(workflows: Workflow[]): Promise<void> {
    if (!workflows.length) {
      return;
    }
    const results: Promise<void>[] = [];
    for (const workflow of workflows) {
      results.push(this.collect(workflow));
    }
    await Promise.all(results);
  }

  private async collect(workflow: Workflow): Promise<void> {
    const now = new Date();
    workflow.executeAt = now;
    await this.store.updateWorkflow(workflow);
    await this.store.setWorkflowState(workflow, WorkflowState.Queued);
  }
}
