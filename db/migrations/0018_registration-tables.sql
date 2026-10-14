-- BUILD-004 etape 2, EA-014 / TASK-051 (ADR-0021, D1) : demandes d'inscription du
-- fondateur et leur historique.
--
-- EXCEPTION RLS ASSUMEE (ADR-0005) : registration_requests et registration_events sont
-- GLOBALES -- ni organization_id de scope, ni politique RLS. L'organisation du fondateur
-- n'existe pas encore au moment de la demande ; elle est creee par la cascade de
-- validation (EA-018). L'acces est controle cote application : un fondateur ne lit que
-- SA demande (user_id issu de la session verifiee, jamais d'une valeur client) ;
-- l'equipe passe par @RequirePlatformAdmin (TASK-058).
--
-- Contraintes de coherence (proposees en TASK-051, non citees par l'ADR) :
-- registration_requests_refusal_complete_check (un refus porte ses deux messages, R8) et
-- registration_requests_active_has_organization_check (ACTIVE => organisation creee).
--
-- Les privileges (append-only de registration_events, pas de DELETE sur
-- registration_requests) sont dans 0019, appliquee APRES la creation du role
-- cabinetos_app dans ci.yml -- sinon le GRANT ALL de la CI les annulerait.
--
-- Ecrite a la main depuis le DDL genere par drizzle-kit pour
-- apps/api/src/business/registration/infrastructure/schema.ts (meme convention que
-- 0015 a 0017 : le journal drizzle-kit s'arrete a 0014).

CREATE TABLE "registration_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"specialty" text NOT NULL,
	"inpe" text,
	"numero_ordre" text,
	"structure_name" text NOT NULL,
	"city" text NOT NULL,
	"address" text,
	"internal_note" text,
	"refusal_internal_reason" text,
	"refusal_message_to_applicant" text,
	"last_email_resent_at" timestamp,
	"organization_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "registration_requests_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "registration_requests_status_check" CHECK ("registration_requests"."status" IN ('PENDING_VERIFICATION', 'COMPLEMENT_REQUESTED', 'ACTIVE', 'REFUSED')),
	CONSTRAINT "registration_requests_refusal_complete_check" CHECK ("registration_requests"."status" <> 'REFUSED' OR ("registration_requests"."refusal_internal_reason" IS NOT NULL AND "registration_requests"."refusal_message_to_applicant" IS NOT NULL)),
	CONSTRAINT "registration_requests_active_has_organization_check" CHECK ("registration_requests"."status" <> 'ACTIVE' OR "registration_requests"."organization_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "registration_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"registration_request_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"email_template" text,
	"email_failure_retryable" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "registration_events_action_check" CHECK ("registration_events"."action" IN ('REQUEST_SUBMITTED', 'COMPLEMENT_REQUESTED', 'RETURNED_TO_VERIFICATION', 'VALIDATED', 'REFUSED', 'EMAIL_RESEND_REQUESTED', 'EMAIL_SENT', 'EMAIL_FAILED')),
	CONSTRAINT "registration_events_email_template_check" CHECK ("registration_events"."email_template" IS NULL OR "registration_events"."email_template" IN ('registration-confirmation', 'verification-complement', 'account-activation', 'registration-refusal')),
	CONSTRAINT "registration_events_email_template_presence_check" CHECK (("registration_events"."action" IN ('EMAIL_RESEND_REQUESTED', 'EMAIL_SENT', 'EMAIL_FAILED')) = ("registration_events"."email_template" IS NOT NULL)),
	CONSTRAINT "registration_events_failure_retryable_check" CHECK (("registration_events"."action" = 'EMAIL_FAILED') = ("registration_events"."email_failure_retryable" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_events" ADD CONSTRAINT "registration_events_registration_request_id_registration_requests_id_fk" FOREIGN KEY ("registration_request_id") REFERENCES "public"."registration_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_events" ADD CONSTRAINT "registration_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_requests_status_idx" ON "registration_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "registration_requests_created_at_idx" ON "registration_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "registration_events_request_id_idx" ON "registration_events" USING btree ("registration_request_id","created_at");

-- DOWN (rollback documente, non execute automatiquement -- a appliquer manuellement avec
-- le role postgres / ADMIN_DATABASE_URL, APRES le DOWN de 0019) :
--   DROP TABLE registration_events;
--   DROP TABLE registration_requests;
