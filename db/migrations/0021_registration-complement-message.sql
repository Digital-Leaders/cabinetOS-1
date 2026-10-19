-- BUILD-004 etape 2, EA-015 / TASK-054 (ADR-0022, revision d'ADR-0021 D1) : dernier message
-- de complement SORTANT, conserve a seule fin d'etre renvoye a l'identique.
--
-- Les deux colonnes contiennent exactement les parametres du modele d'email
-- verification-complement (EA-013), tels qu'envoyes : le renvoi les relit sans rien
-- reconstruire. Ecrites par l'action admin « Demander un complement » (EA-018), ecrasees a
-- chaque nouvelle demande. Jamais la reponse du medecin, jamais un historique (R7 reformulee).
--
-- Hygiene imposee par la base : COMPLEMENT_REQUESTED => message present (renvoi toujours
-- possible) ; ACTIVE ou REFUSED => message efface (plus aucun usage).

ALTER TABLE "registration_requests" ADD COLUMN "complement_requested_info" text;--> statement-breakpoint
ALTER TABLE "registration_requests" ADD COLUMN "complement_message" text;--> statement-breakpoint
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_complement_present_check"
  CHECK ("status" <> 'COMPLEMENT_REQUESTED' OR ("complement_requested_info" IS NOT NULL AND "complement_message" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_complement_cleared_check"
  CHECK ("status" NOT IN ('ACTIVE', 'REFUSED') OR ("complement_requested_info" IS NULL AND "complement_message" IS NULL));

-- DOWN (rollback documente, non execute automatiquement -- role postgres) :
--   ALTER TABLE registration_requests DROP CONSTRAINT registration_requests_complement_cleared_check;
--   ALTER TABLE registration_requests DROP CONSTRAINT registration_requests_complement_present_check;
--   ALTER TABLE registration_requests DROP COLUMN complement_message;
--   ALTER TABLE registration_requests DROP COLUMN complement_requested_info;
