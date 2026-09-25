CREATE TABLE "permit_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_key" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"space_address" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"allocation_id" text NOT NULL,
	"recipient" text NOT NULL,
	"amount" text NOT NULL,
	"request_id" text NOT NULL,
	"nonce" text NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"policy_version" text NOT NULL,
	"permit_digest" text NOT NULL,
	"world_verified_at" timestamp with time zone,
	"risk_score" text,
	"risk_traits" text,
	"risk_checked_at" timestamp with time zone,
	"signature" text,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permit_intents_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "world_challenges" ADD COLUMN "intent_id" uuid;--> statement-breakpoint
ALTER TABLE "world_challenges" ADD COLUMN "signal_hash" text;--> statement-breakpoint
ALTER TABLE "world_proofs" ADD COLUMN "intent_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "permit_intents_actor_request_key" ON "permit_intents" USING btree ("actor","request_key");--> statement-breakpoint
ALTER TABLE "world_proofs" ADD CONSTRAINT "world_proofs_intent_id_unique" UNIQUE("intent_id");