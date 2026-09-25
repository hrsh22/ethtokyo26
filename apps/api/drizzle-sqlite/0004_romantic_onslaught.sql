CREATE TABLE `agent_policies` (
	`request_id` text PRIMARY KEY NOT NULL,
	`space_address` text NOT NULL,
	`allocation_id` text NOT NULL,
	`name` text NOT NULL,
	`agent` text NOT NULL,
	`registry` text NOT NULL,
	`name_id` text NOT NULL,
	`resource` text NOT NULL,
	`daily_cap` text NOT NULL,
	`max_per_payment` text NOT NULL,
	`approval_threshold` text NOT NULL,
	`expiry` text NOT NULL,
	`permit_request_id` text NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_policies_allocation` ON `agent_policies` (`space_address`,`allocation_id`);--> statement-breakpoint
CREATE TABLE `agent_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`owner` text NOT NULL,
	`actor` text NOT NULL,
	`draft_id` text NOT NULL,
	`space_address` text NOT NULL,
	`allocation_id` text NOT NULL,
	`request_key` text NOT NULL,
	`payload` text NOT NULL,
	`policy_version` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`identity_id` text,
	`verified_at` integer,
	`verification_session` text,
	`expires_at` integer NOT NULL,
	`envelope` text,
	`permit_intent_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_requests_actor_key` ON `agent_requests` (`actor`,`request_key`);--> statement-breakpoint
CREATE INDEX `agent_requests_owner` ON `agent_requests` (`owner`);--> statement-breakpoint
CREATE TABLE `namespace_deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`transaction_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `owner_identities` (
	`address` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `space_namespaces` (
	`space_address` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`name` text NOT NULL,
	`registry` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `world_authorizations` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`session_hash` text NOT NULL,
	`owner` text NOT NULL,
	`nonce` text NOT NULL,
	`verifier` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
