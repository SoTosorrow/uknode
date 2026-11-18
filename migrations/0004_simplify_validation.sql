PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ext_ai_video_nodes` (
	`node_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`image_path` text,
	`image_name` text,
	`prompt` text,
	`output_filename` text,
	`steps` integer,
	`input_order` text,
	FOREIGN KEY (`node_id`) REFERENCES `base_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ext_ai_video_kind" CHECK("__new_ext_ai_video_nodes"."kind" in ('image', 'prompt', 'output'))
);
--> statement-breakpoint
INSERT INTO `__new_ext_ai_video_nodes`("node_id", "kind", "image_path", "image_name", "prompt", "output_filename", "steps", "input_order") SELECT "node_id", "kind", "image_path", "image_name", "prompt", "output_filename", "steps", "input_order" FROM `ext_ai_video_nodes`;--> statement-breakpoint
DROP TABLE `ext_ai_video_nodes`;--> statement-breakpoint
ALTER TABLE `__new_ext_ai_video_nodes` RENAME TO `ext_ai_video_nodes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `base_batch_receipts` DROP COLUMN `payload_hash`;