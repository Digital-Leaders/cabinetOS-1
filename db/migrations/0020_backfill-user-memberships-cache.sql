-- BUILD-004 etape 2, EA-014 / TASK-052 (ADR-0021, P1) : rattrapage du cache
-- users.organization_memberships pour les comptes anterieurs a 0017.
--
-- POURQUOI : la recuperation d'un compte orphelin (P1) ne doit JAMAIS toucher un compte
-- d'equipe. Elle reconnait un compte d'equipe a ses adhesions, lues dans ce cache
-- (ADR-0019 : memberships est sous RLS forcee, illisible sans contexte d'organisation).
-- 0017 a cree la colonne avec la valeur '[]' sans la remplir : un compte qui avait deja
-- des adhesions avant 0017 aurait donc un cache vide, et ressemblerait a un orphelin.
-- Cette migration remplit ces caches a partir de memberships.
--
-- Idempotente : elle ne touche que les caches VIDES de comptes qui ont au moins une
-- adhesion ; un cache deja maintenu (createMembership, meme transaction) est laisse tel
-- quel. isDefault = false partout, comme appendOrganizationMembership : aucun defaut
-- n'est invente ; l'utilisateur multi-organisations choisira a sa prochaine connexion.
--
-- Executee par le role postgres (migrations), qui lit memberships sans contexte RLS.

UPDATE users u
SET organization_memberships = filled.memberships
FROM (
  SELECT
    m.user_id,
    jsonb_agg(
      jsonb_build_object(
        'organizationId', m.organization_id,
        'organizationName', o.name,
        'isDefault', false
      )
      ORDER BY m.created_at
    ) AS memberships
  FROM memberships m
  JOIN organizations o ON o.id = m.organization_id
  GROUP BY m.user_id
) AS filled
WHERE u.id = filled.user_id
  AND u.organization_memberships = '[]'::jsonb;

-- DOWN : aucun retour en arriere utile (les valeurs ecrites sont exactement celles que
-- createMembership aurait ecrites). Ne pas vider les caches : cela recreerait le risque
-- que cette migration corrige.
