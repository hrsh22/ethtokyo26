CREATE TABLE "world_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"mode" text NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_proofs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"nullifier" text NOT NULL,
	"action" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_sessions" (
	"address" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "world_proofs_nullifier_action" ON "world_proofs" USING btree ("nullifier","action");