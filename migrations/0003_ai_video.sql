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
	CONSTRAINT "ext_ai_video_kind" CHECK("ext_ai_video_nodes"."kind" in ('image', 'prompt', 'output')),
	CONSTRAINT "ext_ai_video_steps" CHECK("ext_ai_video_nodes"."steps" is null or "ext_ai_video_nodes"."steps" between 1 and 1000)
);
