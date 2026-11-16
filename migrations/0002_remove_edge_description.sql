ALTER TABLE `base_edges` DROP COLUMN `label`;
--> statement-breakpoint
-- Receipt hashes now cover the complete canonical payload. Old sessions must reload.
DELETE FROM `base_batch_receipts`;
--> statement-breakpoint
UPDATE `base_store_state` SET `revision` = `revision` + 1 WHERE `id` = 1;
