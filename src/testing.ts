import type {
  Activity,
  ActivityCallback,
  ActivityPlugin,
  Workflow,
  WorkflowPlugin,
} from "./executor";

export class FakeWorkflowPlugin implements WorkflowPlugin {
  type: string;
  activityTypes: string[];

  constructor({
    type,
    activityTypes = [],
  }: {
    type: string;
    activityTypes?: string[];
  }) {
    this.type = type;
    this.activityTypes = activityTypes;
  }

  async plan(_workflow: Workflow): Promise<string[]> {
    return this.activityTypes;
  }
}

export class FakeActivityPlugin implements ActivityPlugin {
  type: string;
  executeCalled: number;
  executeFunc: ActivityCallback | undefined;
  rollbackCalled: number;
  rollbackFunc: ActivityCallback | undefined;

  constructor({
    type,
    executeCalled = 0,
    executeFunc = undefined,
    rollbackCalled = 0,
    rollbackFunc = undefined,
  }: {
    type: string;
    executeCalled?: number;
    executeFunc?: ActivityCallback;
    rollbackCalled?: number;
    rollbackFunc?: ActivityCallback;
  }) {
    this.type = type;
    this.executeCalled = executeCalled;
    this.executeFunc = executeFunc;
    this.rollbackCalled = rollbackCalled;
    this.rollbackFunc = rollbackFunc;
  }

  async execute(workflow: Workflow, activity: Activity): Promise<void> {
    this.executeCalled += 1;
    if (this.executeFunc) {
      await this.executeFunc(workflow, activity);
    }
  }

  async rollback(workflow: Workflow, activity: Activity): Promise<void> {
    this.rollbackCalled += 1;
    if (this.rollbackFunc) {
      await this.rollbackFunc(workflow, activity);
    }
  }
}
