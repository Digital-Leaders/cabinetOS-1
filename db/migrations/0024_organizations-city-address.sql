-- BUILD-004 etape 2, EA-018 / TASK-062 (ADR-0021 D6, brief R5) : ville et adresse de l'organisation.
--
-- R5 « Aucune ressaisie » : les donnees d'inscription pre-remplissent l'organisation (nom, VILLE,
-- ADRESSE). Le nom existe deja ; cette migration ajoute les deux colonnes manquantes, que la cascade
-- de validation (TASK-063) renseignera depuis la demande du fondateur.
--
-- NULLABLES : les organisations qui existent deja (comptes d'equipe, demos de l'etape 1) n'ont ni
-- ville ni adresse, et rien ne les y oblige. Additive : aucune ligne existante n'est modifiee.
-- Idempotente (IF NOT EXISTS) : rejouable sans effet. organizations n'a pas de RLS (elle EST l'unite
-- d'isolation) : aucune politique a ajouter.
--
-- Ecrite a la main (meme convention que 0015 a 0023 : le journal drizzle-kit s'arrete a 0014) ; le
-- schema Drizzle (organization/infrastructure/schema.ts) porte les memes colonnes.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "city" text;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "address" text;

-- DOWN (rollback documente, non execute automatiquement -- role postgres) :
--   ALTER TABLE organizations DROP COLUMN address;
--   ALTER TABLE organizations DROP COLUMN city;
-- Attention : supprime la ville et l'adresse deja renseignees par la cascade de validation.
