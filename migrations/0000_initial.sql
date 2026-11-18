CREATE TABLE `base_batch_receipts` (
	`batch_id` text PRIMARY KEY NOT NULL,
	`payload_hash` text NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `base_batch_receipts_revision_idx` ON `base_batch_receipts` (`revision`);--> statement-breakpoint
CREATE TABLE `base_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`directed` integer DEFAULT false NOT NULL,
	`label` text DEFAULT '' NOT NULL,
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `base_store_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "base_store_state_singleton" CHECK("base_store_state"."id" = 1),
	CONSTRAINT "base_store_state_revision" CHECK("base_store_state"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `view_node_layouts` (
	`node_id` text PRIMARY KEY NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `base_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
