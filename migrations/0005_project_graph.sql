-- Start the project-based editor with an empty graph. Applied once by Drizzle.
DROP TABLE ext_ai_video_nodes;--> statement-breakpoint
DROP TABLE view_node_layouts;--> statement-breakpoint
DROP TABLE base_memberships;--> statement-breakpoint
DROP TABLE base_edges;--> statement-breakpoint
DROP TABLE base_nodes;--> statement-breakpoint
DROP TABLE base_store_state;--> statement-breakpoint
DROP TABLE base_batch_receipts;--> statement-breakpoint
CREATE TABLE `base_batch_receipts` (
	`project_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`project_id`, `batch_id`),
	FOREIGN KEY (`project_id`) REFERENCES `base_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `base_batch_receipts_revision_idx` ON `base_batch_receipts` (`project_id`,`revision`);--> statement-breakpoint
CREATE TABLE `base_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`directed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_node_id`) REFERENCES `base_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_node_id`) REFERENCES `base_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "base_edges_direction_check" CHECK("base_edges"."directed" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `base_edges_source_idx` ON `base_edges` (`source_node_id`);--> statement-breakpoint
CREATE INDEX `base_edges_target_idx` ON `base_edges` (`target_node_id`);--> statement-breakpoint
CREATE TABLE `base_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `base_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `base_nodes_project_idx` ON `base_nodes` (`project_id`);--> statement-breakpoint
CREATE TABLE `base_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`business` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `view_node_layouts` (
	`node_id` text PRIMARY KEY NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `base_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ext_ai_video_nodes` (
	`node_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`image_path` text,
	`image_name` text,
	`prompt` text,
	`output_filename` text,
	`steps` integer,
	`input_order` text,
	FOREIGN KEY (`node_id`) REFERENCES `base_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ext_ai_video_kind" CHECK("ext_ai_video_nodes"."kind" in ('image', 'prompt', 'output'))
);
