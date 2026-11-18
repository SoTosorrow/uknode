CREATE TABLE `base_memberships` (
	`container_node_id` text NOT NULL,
	`member_node_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`container_node_id`, `member_node_id`),
	FOREIGN KEY (`container_node_id`) REFERENCES `base_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_node_id`) REFERENCES `base_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "base_memberships_not_self" CHECK("base_memberships"."container_node_id" <> "base_memberships"."member_node_id")
);
--> statement-breakpoint
CREATE INDEX `base_memberships_member_idx` ON `base_memberships` (`member_node_id`);--> statement-breakpoint
CREATE TABLE `__new_view_node_layouts` (
	`context_node_id` text,
	`node_id` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	FOREIGN KEY (`context_node_id`) REFERENCES `base_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `base_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Existing positions belong to the global canvas. Preserve every coordinate.
INSERT INTO `__new_view_node_layouts`("context_node_id", "node_id", "x", "y") SELECT NULL, "node_id", "x", "y" FROM `view_node_layouts`;--> statement-breakpoint
DROP TABLE `view_node_layouts`;--> statement-breakpoint
ALTER TABLE `__new_view_node_layouts` RENAME TO `view_node_layouts`;--> statement-breakpoint
CREATE UNIQUE INDEX `view_layout_context_node_idx` ON `view_node_layouts` (`context_node_id`,`node_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `view_layout_global_node_idx` ON `view_node_layouts` (`node_id`) WHERE "view_node_layouts"."context_node_id" is null;--> statement-breakpoint
CREATE INDEX `view_layout_node_idx` ON `view_node_layouts` (`node_id`);
