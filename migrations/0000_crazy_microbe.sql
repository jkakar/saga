CREATE TYPE "public"."activity_state" AS ENUM('pending', 'running', 'failed_permanent', 'failed_temporary', 'succeeded');--> statement-breakpoint
CREATE TYPE "public"."workflow_state" AS ENUM('queued', 'pending', 'running', 'running_retry', 'running_rollback', 'failed', 'failed_rollback', 'succeeded');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"state" "activity_state" NOT NULL,
	"type" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_locks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expire_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"state" "workflow_state" NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"activity_types" text[] NOT NULL,
	"attempts" integer NOT NULL,
	"execute_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
