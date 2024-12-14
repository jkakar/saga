import { v5 as uuidv5 } from "uuid";
import config from "~/config.server";

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

export class PluginRegistry<T extends ExecutorPlugin> {
	private plugins = new Map<string, T>();

	register(plugin: T): void {
		this.plugins.set(plugin.type, plugin);
	}

	lookup(type: string): T | undefined {
		return this.plugins.get(type);
	}
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

export interface Notifier {
	beginWorkflow(workflow: Workflow): Promise<void>;
	beginActivity(workflow: Workflow, activity: Activity): Promise<void>;
	endWorkflow(workflow: Workflow): Promise<void>;
	endActivity(workflow: Workflow, activity: Activity): Promise<void>;
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
			config.logger.info(
				{
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
				},
				"starting activity plugin",
			);
			await callback(workflow, activity);
		} catch (err) {
			activity.state = ActivityState.FailedTemporary;
			if (err === ActivityState.FailedPermanent) {
				activity.state = ActivityState.FailedPermanent;
			}
			config.logger.error(
				{
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
				},
				"activity plugin error",
			);
			await this.store.updateActivity(activity);
			return;
		}
		config.logger.info(
			{
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
			},
			"finished activity plugin",
		);
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
		config.logger.info(input, "creating workflow");
		return this.store.createWorkflow(input);
	}

	async execute(workflow: Workflow, notifier?: Notifier): Promise<void> {
		config.logger.info(
			{
				id: workflow.id,
				type: workflow.type,
				state: workflow.state,
				refId: workflow.refId,
				refType: workflow.refType,
				attempts: workflow.attempts,
				activityTypes: workflow.activityTypes,
			},
			"starting workflow",
		);
		await this.store.lockWorkflow(workflow);
		try {
			await notifier?.beginWorkflow(workflow);
			await this.converge(workflow, notifier);
		} finally {
			await this.store.unlockWorkflow(workflow);
			await notifier?.endWorkflow(workflow);
		}
		config.logger.info(
			{
				id: workflow.id,
				type: workflow.type,
				state: workflow.state,
				refId: workflow.refId,
				refType: workflow.refType,
				attempts: workflow.attempts,
				activityTypes: workflow.activityTypes,
				durationSeconds:
					(new Date().getTime() - workflow.createdAt.getTime()) / 1000,
			},
			"finished workflow",
		);
	}

	private async converge(
		workflow: Workflow,
		notifier?: Notifier,
	): Promise<void> {
		config.logger.debug(
			{
				id: workflow.id,
				type: workflow.type,
				state: workflow.state,
				refId: workflow.refId,
				refType: workflow.refType,
				attempts: workflow.attempts,
				activityTypes: workflow.activityTypes,
			},
			"converging workflow",
		);
		switch (workflow.state) {
			case WorkflowState.Queued:
				throw "unexpected workflow state";
			case WorkflowState.Pending:
				await this.handlePending(workflow);
				await this.converge(workflow, notifier);
				return;
			case WorkflowState.Running:
				await this.handleRunning(workflow, notifier);
				await this.converge(workflow, notifier);
				return;
			case WorkflowState.RunningRetry:
				await this.handleRunningRetry(workflow);
				return;
			case WorkflowState.RunningRollback:
				await this.handleRunningRollback(workflow, notifier);
				await this.converge(workflow, notifier);
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
		config.logger.info(
			{
				id: workflow.id,
				type: workflow.type,
				state: workflow.state,
				refId: workflow.refId,
				refType: workflow.refType,
				attempts: workflow.attempts,
				activityTypes: workflow.activityTypes,
			},
			"planned workflow",
		);
		await this.store.setWorkflowState(workflow, WorkflowState.Running);
	}

	private async handleRunning(
		workflow: Workflow,
		notifier?: Notifier,
	): Promise<void> {
		for (const activityType of workflow.activityTypes) {
			const activity = await this.executor.create(workflow, activityType);
			await notifier?.beginActivity(workflow, activity);
			try {
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
			} finally {
				await notifier?.endActivity(workflow, activity);
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

	private async handleRunningRollback(
		workflow: Workflow,
		notifier?: Notifier,
	): Promise<void> {
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
			await notifier?.beginActivity(workflow, rollbackActivity);
			try {
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
			} finally {
				await notifier?.endActivity(workflow, rollbackActivity);
			}
		}
		await this.store.setWorkflowState(workflow, WorkflowState.Failed);
	}
}
