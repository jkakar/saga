A TypeScript library for managing workflows based on the saga pattern.

## Overview

A workflow defines one or more activities to run. The `WorkflowExecutor`
executes a workflow's activities in sequence, one at a time. If an activity
experiences a temporary failure it will be queued to be retried. If it
experiences a permanent failure the `Workflow` is rolled back.

A workflow is defined by implementing a `WorkflowPlugin` that has a `plan`
method that returns the activity types the workflow needs to run, along with one
or more `ActivityPlugin` implementations that implement application logic. An
`ActivityPlugin` must provide an `execute` method that's run in the happy path,
and a `rollback` method that's run after a permanent failure occurs. The plugins
are registered with a `WorkflowExecutor`.

```typescript
const workflows = new PluginRegistry<WorkflowPlugin>();
const activities = new PluginRegistry<ActivityPlugin>();
const store = new MemoryStore();
const executor = new WorkflowExecutor(store, workflows, activities);

workflows.register(new SampleWorkflowPlugin());
activities.register(new SampleActivityPlugin());
```

Workflows can be executed after plugins are registered.

```typescript
const workflow = await executor.create({
  id: uuid.v4(),
  type: `sample-workflow`,
  refType: "sample-ref",
  refId: uuid.v4(),
});
await executor.execute(workflow);
```

The `refType` and `refId` inputs aren't used by the workflow executor. They're
purpose is to provide an input to the workflow.

## License

This project is licensed under the MIT License.
