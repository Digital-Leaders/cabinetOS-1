-- BUILD-004 etape 2, EA-017 / TASK-058 (ADR-0021 D3, P3) : administrateurs de PLATEFORME.
--
-- Table GLOBALE, sans RLS : c'est la SEULE table qui transcende l'isolation des
-- organisations. Un administrateur de plateforme (equipe CabinetOS) n'a aucune organisation ;
-- cette table ne lui ouvre que les endpoints @RequirePlatformAdmin(). Elle ne donne acces a
-- AUCUNE donnee d'organisation.
--
-- Trace exigee par la base elle-meme : granted_by (qui a ajoute) et reason (pourquoi) ne
-- peuvent pas etre vides (CHECK). Un retrait n'efface pas la ligne : revoked_at la conserve.
--
-- Privileges dans 0023, appliquee APRES la creation du role cabinetos_app (ci.yml) : le role
-- applicatif n'a que SELECT. Ecrite a la main depuis le DDL genere par drizzle-kit (meme
-- convention que 0015 a 0021).

CREATE TABLE "platform_admins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"granted_by" text NOT NULL,
	"reason" text NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "platform_admins_granted_by_check" CHECK (length(btrim("platform_admins"."granted_by")) > 0),
	CONSTRAINT "platform_admins_reason_check" CHECK (length(btrim("platform_admins"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

-- DOWN (rollback documente, non execute automatiquement -- role postgres, APRES le DOWN de 0023) :
--   DROP TABLE platform_admins;
