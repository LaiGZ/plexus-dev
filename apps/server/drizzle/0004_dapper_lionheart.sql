CREATE TABLE `app_grants` (
	`source_id` text NOT NULL,
	`tool_id` text NOT NULL,
	PRIMARY KEY(`source_id`, `tool_id`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_id`) REFERENCES `tools`(`id`) ON UPDATE no action ON DELETE cascade
);
