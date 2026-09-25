ALTER TABLE "space_drafts" ADD COLUMN "space_address" text;--> statement-breakpoint
ALTER TABLE "space_drafts" ADD COLUMN "token_address" text;--> statement-breakpoint
ALTER TABLE "space_drafts" ADD COLUMN "deployment_tx" text;--> statement-breakpoint
ALTER TABLE "space_drafts" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "space_drafts" ADD CONSTRAINT "space_drafts_space_address_unique" UNIQUE("space_address");--> statement-breakpoint
ALTER TABLE "space_drafts" ADD CONSTRAINT "space_drafts_deployment_tx_unique" UNIQUE("deployment_tx");