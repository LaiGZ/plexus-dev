CREATE TABLE `service_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `service_tokens_source_idx` ON `service_tokens` (`source_id`);--> statement-breakpoint
CREATE TABLE `token_apps` (
	`token_id` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`token_id`, `source_id`),
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `invocations` ADD `actor_type` text;--> statement-breakpoint
ALTER TABLE `invocations` ADD `actor_id` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `app_secret_hash` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `app_secret_prefix` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `app_secret_created_at` integer;