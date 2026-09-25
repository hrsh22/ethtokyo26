CREATE TABLE `received_allocations` (
	`space_address` text NOT NULL,
	`allocation_id` text NOT NULL,
	`beneficiary` text NOT NULL,
	`created_block` text NOT NULL,
	PRIMARY KEY(`space_address`, `allocation_id`)
);
--> statement-breakpoint
CREATE INDEX `received_allocations_beneficiary_idx` ON `received_allocations` (`beneficiary`);--> statement-breakpoint
ALTER TABLE `space_drafts` ADD `allocation_scan_block` text;