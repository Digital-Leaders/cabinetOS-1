-- TASK-026 (BUILD-002, EA-009) : recherche floue sur nom+prenom (Q4 du Decision Gate) --
-- insensible a la casse et aux accents, tolerante aux variantes de translitteration
-- (Fatma/Fatima, Benani/Bennani). pg_trgm mesure la similarite de sous-chaines
-- (tolere les variations locales, dont les doubles consonnes) ; unaccent normalise
-- les accents avant comparaison.
--
-- L index porte sur la concatenation prenom+nom en minuscules sans accents -- la
-- fonction de recherche (patient-search.queries.ts) applique la meme transformation
-- cote saisie pour que la comparaison se fasse toujours sur des formes identiques.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() n est pas declaree IMMUTABLE par Postgres (contrainte connue), donc pas
-- utilisable directement dans un index. Enveloppe immutable, standard pour ce cas --
-- le dictionnaire unaccent utilise ici est fixe, son comportement est stable en
-- pratique pour cet usage.
--
-- CORRECTION (clôture BUILD-004, étape 2) : cette fonction était d'abord écrite en LANGUAGE sql
-- (`SELECT unaccent('unaccent', $1)`). Depuis PostgreSQL 17, la creation d'un index s'execute avec un
-- search_path restreint : unaccent() n'y est plus trouvee et le CREATE INDEX ci-dessous echouait
-- (« function unaccent(unknown, text) does not exist »). Cet echec etait sans consequence tant que les
-- erreurs de psql etaient ignorees, car la migration 0010 recreait ensuite fonction et index. La forme
-- ci-dessous est celle que pose 0010 (plpgsql, jamais inlinee, search_path fixe sur la fonction) : 0009
-- reussit desormais sur PostgreSQL 16, 17 et 18, et 0010 la recree a l'identique.
CREATE OR REPLACE FUNCTION patient_search_unaccent(text) RETURNS text AS $$
BEGIN
  RETURN unaccent($1);
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE STRICT SET search_path = public, pg_catalog;

CREATE INDEX patients_name_trgm_idx ON patients
  USING gin (patient_search_unaccent(lower(first_name || ' ' || last_name)) gin_trgm_ops);

-- DOWN (rollback documente, non execute automatiquement) :
--   DROP INDEX IF EXISTS patients_name_trgm_idx;
--   DROP FUNCTION IF EXISTS patient_search_unaccent(text);
--   DROP EXTENSION IF EXISTS unaccent;
--   DROP EXTENSION IF EXISTS pg_trgm;
-- Attention : DROP EXTENSION echouera si un autre objet de la base depend encore
-- de pg_trgm/unaccent -- verifier avant d appliquer ce rollback.