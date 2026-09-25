CREATE TABLE "research_quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"draft_id" uuid NOT NULL,
	"allocation_id" text NOT NULL,
	"space_address" text NOT NULL,
	"token_address" text NOT NULL,
	"recipient" text NOT NULL,
	"amount" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"transaction_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_quotes_transaction_hash_unique" UNIQUE("transaction_hash")
);
