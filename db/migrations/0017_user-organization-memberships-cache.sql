-- Parcours d'acces, etape 1, commit 2 (ADR-0019) : cache des adhesions d'un
-- utilisateur, porte par son compte -- users n a jamais eu de politique RLS
-- (contrairement a memberships), donc lisible/modifiable sans contexte
-- d'organisation deja etabli. Necessaire pour resoudre l'organisation a la
-- connexion (une seule -> directe ; plusieurs + defaut -> defaut ; plusieurs
-- sans defaut -> ecran de choix) sans contourner RLS.
--
-- Mis a jour dans la MEME transaction que createMembership/deleteMembership
-- (jamais une synchronisation differee) -- voir ADR-0019, section Consequences.
-- Forme : [{ "organizationId": "...", "organizationName": "...", "isDefault": bool }, ...]

ALTER TABLE users ADD COLUMN organization_memberships jsonb NOT NULL DEFAULT '[]';

-- DOWN (rollback documente, non execute automatiquement) :
--   ALTER TABLE users DROP COLUMN organization_memberships;
