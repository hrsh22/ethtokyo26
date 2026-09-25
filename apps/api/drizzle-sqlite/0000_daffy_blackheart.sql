CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`message` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `permit_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`draft_id` text NOT NULL,
	`space_address` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`allocation_id` text NOT NULL,
	`recipient` text NOT NULL,
	`amount` text NOT NULL,
	`request_id` text NOT NULL,
	`nonce` text NOT NULL,
	`expiry` integer NOT NULL,
	`policy_version` text NOT NULL,
	`permit_digest` text NOT NULL,
	`world_verified_at` integer,
	`risk_score` text,
	`risk_traits` text,
	`risk_checked_at` integer,
	`signature` text,
	`signed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permit_intents_request_id_unique` ON `permit_intents` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `permit_intents_actor_request_key` ON `permit_intents` (`actor`,`request_key`);--> statement-breakpoint
CREATE TABLE `research_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`draft_id` text NOT NULL,
	`allocation_id` text NOT NULL,
	`space_address` text NOT NULL,
	`token_address` text NOT NULL,
	`recipient` text NOT NULL,
	`amount` text NOT NULL,
	`expires_at` integer NOT NULL,
	`transaction_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_quotes_transaction_hash_unique` ON `research_quotes` (`transaction_hash`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `space_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`template_id` text NOT NULL,
	`space_address` text,
	`token_address` text,
	`deployment_tx` text,
	`activated_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_drafts_space_address_unique` ON `space_drafts` (`space_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `space_drafts_deployment_tx_unique` ON `space_drafts` (`deployment_tx`);--> statement-breakpoint
CREATE TABLE `world_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`mode` text NOT NULL,
	`intent_id` text,
	`signal_hash` text,
	`nonce` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `world_proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`nullifier` text NOT NULL,
	`action` text NOT NULL,
	`intent_id` text,
	`verified_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `world_proofs_intent_id_unique` ON `world_proofs` (`intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `world_proofs_nullifier_action` ON `world_proofs` (`nullifier`,`action`);--> statement-breakpoint
CREATE TABLE `world_sessions` (
	`address` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`enrolled_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `world_sessions_session_id_unique` ON `world_sessions` (`session_id`);