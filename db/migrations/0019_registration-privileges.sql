-- BUILD-004 etape 2, EA-014 / TASK-051 (ADR-0021, D1) : privileges du role applicatif sur
-- les tables d'inscription. Meme patron que 0003_audit-events-append-only.sql.
--
-- ORDRE D'APPLICATION : apres la creation du role cabinetos_app (ci.yml). La CI accorde
-- SELECT, INSERT, UPDATE, DELETE sur toutes les tables (et par defaut sur les futures) ;
-- ce REVOKE doit donc passer apres, comme le rejeu de 0003.
--
-- Point de vigilance verifie (propriete des tables) : registration_requests et
-- registration_events appartiennent au role postgres, qui execute les migrations via
-- ADMIN_DATABASE_URL -- jamais cabinetos_app. Les privileges de cabinetos_app viennent
-- d'un GRANT explicite sans WITH GRANT OPTION (information_schema.role_table_grants :
-- is_grantable = NO). Ce REVOKE n'est donc pas contournable par un re-GRANT.
--
-- registration_events : append-only (historique fiable, D1) -- ni UPDATE ni DELETE.
-- registration_requests : pas de DELETE. Une demande ne disparait jamais : elle change
-- de statut (P2 : le compte et sa demande sont conserves au refus). La compensation et
-- la recuperation d'orphelin (TASK-052, P1) suppriment des COMPTES sans demande, jamais
-- une demande.
--
-- Pas de RLS sur ces tables (exception assumee, voir 0018) : ce REVOKE interdit un TYPE
-- d'operation, le controle des LIGNES accessibles est applicatif.

REVOKE UPDATE, DELETE ON registration_events FROM cabinetos_app;
REVOKE DELETE ON registration_requests FROM cabinetos_app;

-- DOWN (rollback documente, non execute automatiquement -- a appliquer manuellement avec
-- le role postgres / ADMIN_DATABASE_URL en cas de retour en arriere) :
--   GRANT UPDATE, DELETE ON registration_events TO cabinetos_app;
--   GRANT DELETE ON registration_requests TO cabinetos_app;
