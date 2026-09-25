CREATE TABLE `allocation_names` (
	`request_id` text PRIMARY KEY NOT NULL,
	`space_address` text NOT NULL,
	`allocation_id` text NOT NULL,
	`beneficiary` text NOT NULL,
	`name` text NOT NULL,
	`resolved_block` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
