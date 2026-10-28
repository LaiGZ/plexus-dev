CREATE TABLE `idempotency_records` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`key_hash` text NOT NULL,
	`request_digest` text NOT NULL,
	`state` text NOT NULL,
	`response_ref` text,
	`lease_until` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_scope_key_idx` ON `idempotency_records` (`scope_key`,`key_hash`);--> statement-breakpoint
CREATE TABLE `invocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`tool_id` text,
	`tool_name` text,
	`source_id` text,
	`token_id` text,
	`via` text DEFAULT 'api' NOT NULL,
	`status` text NOT NULL,
	`latency_ms` integer,
	`request_preview` text,
	`response_preview` text,
	`error_code` text,
	`request_id` text
);
--> statement-breakpoint
CREATE INDEX `invocations_ts_idx` ON `invocations` (`ts`);--> statement-breakpoint
CREATE INDEX `invocations_tool_idx` ON `invocations` (`tool_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`base_url` text NOT NULL,
	`spec` text,
	`auth_type` text DEFAULT 'none' NOT NULL,
	`auth_enc` text,
	`headers` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_slug_unique` ON `sources` (`slug`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL,
	`scope` text DEFAULT 'read' NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_hash_idx` ON `tokens` (`hash`);--> statement-breakpoint
CREATE TABLE `tools` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`mcp_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`input_schema` text DEFAULT '{"type":"object","properties":{}}' NOT NULL,
	`method` text DEFAULT 'POST' NOT NULL,
	`path` text DEFAULT '/' NOT NULL,
	`side_effect` text DEFAULT 'read' NOT NULL,
	`idempotent` integer DEFAULT false NOT NULL,
	`exposed` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tools_mcp_name_unique` ON `tools` (`mcp_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `tools_source_name_idx` ON `tools` (`source_id`,`name`);