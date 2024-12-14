export interface WorkflowInput {
  id: string;
  type: string;
  refType: string;
  refId: string;
  executeAt?: Date;
}

export enum WorkflowState {
  Queued = "queued",
  Pending = "pending",
  Running = "running",
  RunningRetry = "running_retry",
  RunningRollback = "running_rollback",
  Failed = "failed",
  FailedRollback = "failed_rollback",
  Succeeded = "succeeded",
}

export interface Workflow {
  id: string;
  type: string;
  state: string; // TODO Ideally this would be a value of WorkflowState type
  refType: string;
  refId: string;
  activityTypes: string[];
  attempts: number;
  executeAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export enum ActivityState {
  Pending = "pending",
  Running = "running",
  FailedPermanent = "failed_permanent",
  FailedTemporary = "failed_temporary",
  Succeeded = "succeeded",
}

export interface Activity {
  id: string;
  type: string;
  state: string; // TODO Ideally this would be a value of ActivityState type
  workflowId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Store {
  getWorkflowById(id: string): Promise<Workflow | undefined>;
  getWorkflowByRefId(id: string): Promise<Workflow | undefined>;
  getExecutableWorkflows(cutoff: Date, limit: number): Promise<Workflow[]>;
  getLostWorkflows(limit: number): Promise<Workflow[]>;
  createWorkflow(input: WorkflowInput): Promise<Workflow>;
  setWorkflowState(workflow: Workflow, state: WorkflowState): Promise<void>;
  updateWorkflow(workflow: Workflow): Promise<void>;
  tryLockWorkflow(workflow: Workflow): Promise<boolean>;
  lockWorkflow(workflow: Workflow): Promise<void>;
  unlockWorkflow(workflow: Workflow): Promise<void>;
  getActivityByType(
    workflow: Workflow,
    activityType: string,
  ): Promise<Activity | undefined>;
  createActivity(
    workflow: Workflow,
    id: string,
    activityType: string,
  ): Promise<Activity>;
  updateActivity(activity: Activity): Promise<void>;
}

export interface ExecutorPlugin {
  type: string;
}

export interface WorkflowPlugin {
  type: string;
  plan(workflow: Workflow): Promise<string[]>;
}

export interface ActivityPlugin {
  type: string;
  execute(workflow: Workflow, activity: Activity): Promise<void>;
  rollback(workflow: Workflow, activity: Activity): Promise<void>;
}
