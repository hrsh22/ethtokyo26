CREATE TABLE `agent_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`agent` text NOT NULL,
	`draft_id` text NOT NULL,
	`space_address` text NOT NULL,
	`allocation_id` text NOT NULL,
	`name` text NOT NULL,
	`registry` text NOT NULL,
	`name_id` text NOT NULL,
	`resource` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_connections_allocation` ON `agent_connections` (`space_address`,`allocation_id`);--> statement-breakpoint
CREATE TABLE `agent_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`agent` text NOT NULL,
	`name` text,
	`review_hash` text NOT NULL,
	`poll_hash` text NOT NULL,
	`connection_id` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_submissions` (
	`request_id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`transaction_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `research_quotes` ADD `service` text DEFAULT 'space-report' NOT NULL;--> statement-breakpoint
ALTER TABLE `research_quotes` ADD `terms` text;--> statement-breakpoint
ALTER TABLE `research_quotes` ADD `result` text;--> statement-breakpoint
ALTER TABLE `research_quotes` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `research_quotes` ADD `operation_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `research_quotes_connection_operation` ON `research_quotes` (`connection_id`,`operation_key`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `kind` text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `connection_id` text;--> statement-breakpoint
-- Older sessions did not distinguish browser/agent credentials. Require one
-- fresh sign-in so an old unrestricted agent token cannot bypass new scopes.
UPDATE `sessions` SET `expires_at` = 0;
