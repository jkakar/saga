import { CourierClient } from "@trycourier/courier";
import type { Activity, Workflow } from "./executor";

export class SlackNotifier {
  constructor(
    private courierAuthToken: string,
    private slackBotToken: string,
  ) {}

  async beginWorkflow(workflow: Workflow): Promise<void> {
    const message = {
      workflowId: workflow.id,
      workflowType: workflow.type,
      workflowState: workflow.state,
      refId: workflow.refId,
      refType: workflow.refType,
    };
    await this.publish(":gear:", `${workflow.type} workflow started`, message);
  }

  async beginActivity(workflow: Workflow, activity: Activity): Promise<void> {
    const message = {
      workflowId: workflow.id,
      workflowType: workflow.type,
      workflowState: workflow.state,
      refId: workflow.refId,
      refType: workflow.refType,
      activityId: activity.id,
      activityType: activity.type,
      activityState: activity.state,
    };
    await this.publish(":gear:", `${activity.type} activity started`, message);
  }

  async endWorkflow(workflow: Workflow): Promise<void> {
    const message = {
      workflowId: workflow.id,
      workflowType: workflow.type,
      workflowState: workflow.state,
      refId: workflow.refId,
      refType: workflow.refType,
    };
    await this.publish(":gear:", `${workflow.type} workflow ended`, message);
  }

  async endActivity(workflow: Workflow, activity: Activity): Promise<void> {
    const message = {
      workflowId: workflow.id,
      workflowType: workflow.type,
      workflowState: workflow.state,
      refId: workflow.refId,
      refType: workflow.refType,
      activityId: activity.id,
      activityType: activity.type,
      activityState: activity.state,
    };
    await this.publish(":gear:", `${activity.type} activity ended`, message);
  }

  private async publish(
    emoji: string,
    title: string,
    message: Record<string, string>,
  ): Promise<void> {
    const courier = new CourierClient({
      authorizationToken: this.courierAuthToken,
    });
    await courier.send({
      message: {
        to: {
          slack: {
            access_token: this.slackBotToken,
            channel: "C07B64V5SJV", // #ops channel
          },
        },
        template: "6JWK8860MZMP9VGF4XYTP7SDWE9K", // https://app.courier.com/assets/notifications/6JWK8860MZMP9VGF4XYTP7SDWE9K/design
        data: {
          emoji: emoji,
          title: title,
          message: JSON.stringify(message, null, 2),
        },
      },
    });
  }
}
