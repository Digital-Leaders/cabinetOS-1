-- BUILD-004 etape 2, EA-018 / TASK-062 (ADR-0021 D6, brief R4 operation 3) : role « fondateur ».
--
-- A la validation d'une inscription, le fondateur devient le PREMIER MEMBRE de l'organisation creee
-- (brief R4 : « avec un role admin/fondateur »). La cascade (TASK-063) retrouve ce role PAR SON NOM.
--
-- Role GLOBAL (la table roles n'est pas scopee par organisation), comme le catalogue de permissions.
-- Il recoit EXACTEMENT les quatre permissions du catalogue : manage et read, sur patients et medecins
-- -- le perimetre actuel du compte de demonstration. Les permissions de gestion des membres
-- n'existent pas encore et arriveront avec l'etape 3 (invitations) ; rien n'est anticipe ici.
--
-- Contrairement a 0008 et 0011 (qui ne touchent jamais role_permissions : chaque cabinet attribue
-- ses permissions), cette migration ATTRIBUE les permissions de CE role : c'est sa raison d'etre.
--
-- Idempotente : relancee, elle ne duplique ni le role ni ses permissions, et n'en retire aucune.
-- Elle ECHOUE (au lieu de creer silencieusement un role incomplet) si l'une des quatre permissions
-- n'existe pas : les migrations 0008 (patients) et 0011 (medecins) doivent avoir ete appliquees.

INSERT INTO roles (id, name, description)
VALUES (
  gen_random_uuid(),
  'fondateur',
  'Premier membre d''une organisation creee a la validation d''une inscription : gere et consulte les patients et les medecins.'
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON (p.resource, p.action) IN (
    ('patients', 'manage'), ('patients', 'read'),
    ('medecins', 'manage'), ('medecins', 'read')
  )
WHERE r.name = 'fondateur'
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
DECLARE
  granted integer;
BEGIN
  SELECT count(*) INTO granted
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  WHERE r.name = 'fondateur';
  IF granted < 4 THEN
    RAISE EXCEPTION
      'Role fondateur incomplet : % permission(s) sur 4. Les migrations 0008 (patients) et 0011 (medecins) doivent etre appliquees avant.',
      granted;
  END IF;
END $$;

-- DOWN (rollback documente, non execute automatiquement -- role postgres) :
--   DELETE FROM roles WHERE name = 'fondateur';   -- role_permissions suit par ON DELETE CASCADE
-- Attention : echoue si des memberships referencent encore ce role (cle etrangere) -- les retirer d'abord.
