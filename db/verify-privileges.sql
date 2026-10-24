-- Vérification après migration. DOIT RENVOYER ZÉRO LIGNE : chaque ligne renvoyée est une violation.
-- Lecture seule. À exécuter avec la connexion d'administration (ADMIN_DATABASE_URL).
--
-- Chaque contrôle de droit est protégé par un CASE : si le rôle applicatif n'existe pas, la requête signale
-- « rôle introuvable » au lieu d'échouer (has_table_privilege lève une erreur sur un rôle inconnu).

WITH r AS (SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cabinetos_app') AS ok)

SELECT 'rôle cabinetos_app introuvable' AS violation
WHERE NOT (SELECT ok FROM r)

UNION ALL
SELECT 'rôle cabinetos_app : superutilisateur ou contourne la sécurité par ligne'
FROM pg_roles WHERE rolname = 'cabinetos_app' AND (rolsuper OR rolbypassrls)

-- Historiques en ajout seul : le rôle applicatif ne doit ni modifier ni supprimer (migrations 0003, 0019).
UNION ALL
SELECT 'audit_events : le rôle applicatif peut modifier ou supprimer'
WHERE CASE WHEN (SELECT ok FROM r) THEN (has_table_privilege('cabinetos_app', 'audit_events', 'UPDATE')
   OR has_table_privilege('cabinetos_app', 'audit_events', 'DELETE')) ELSE false END
UNION ALL
SELECT 'registration_events : le rôle applicatif peut modifier ou supprimer'
WHERE CASE WHEN (SELECT ok FROM r) THEN (has_table_privilege('cabinetos_app', 'registration_events', 'UPDATE')
   OR has_table_privilege('cabinetos_app', 'registration_events', 'DELETE')) ELSE false END
UNION ALL
SELECT 'registration_requests : le rôle applicatif peut supprimer'
WHERE CASE WHEN (SELECT ok FROM r) THEN (has_table_privilege('cabinetos_app', 'registration_requests', 'DELETE')) ELSE false END

-- Administrateurs de plateforme : lecture seule pour l'application (migration 0023).
UNION ALL
SELECT 'platform_admins : le rôle applicatif peut écrire'
WHERE CASE WHEN (SELECT ok FROM r) THEN (has_table_privilege('cabinetos_app', 'platform_admins', 'INSERT')
   OR has_table_privilege('cabinetos_app', 'platform_admins', 'UPDATE')
   OR has_table_privilege('cabinetos_app', 'platform_admins', 'DELETE')) ELSE false END
UNION ALL
SELECT 'platform_admins : le rôle applicatif ne peut pas lire'
WHERE CASE WHEN (SELECT ok FROM r) THEN (NOT has_table_privilege('cabinetos_app', 'platform_admins', 'SELECT')) ELSE false END

-- Pas de révocation en trop : le rôle applicatif garde ses droits normaux sur les tables métier.
UNION ALL
SELECT t || ' : le rôle applicatif a perdu ses droits normaux'
FROM unnest(ARRAY['patients', 'medecins', 'memberships', 'organizations', 'users', 'registration_requests']) AS t
WHERE CASE WHEN (SELECT ok FROM r) THEN (NOT (has_table_privilege('cabinetos_app', t, 'SELECT')
       AND has_table_privilege('cabinetos_app', t, 'INSERT')
       AND has_table_privilege('cabinetos_app', t, 'UPDATE'))) ELSE false END

-- Sécurité par ligne activée ET forcée sur les huit tables concernées.
UNION ALL
SELECT 'sécurité par ligne non forcée sur ' || t
FROM unnest(ARRAY['audit_events', 'file_objects', 'medecins', 'memberships',
                  'notifications', 'patient_records', 'patients', 'settings']) AS t
WHERE NOT EXISTS (SELECT 1 FROM pg_class c
                  WHERE c.relnamespace = 'public'::regnamespace AND c.relname = t
                    AND c.relrowsecurity AND c.relforcerowsecurity)

-- Objets de l'étape 2 présents (0018 à 0025).
UNION ALL
SELECT 'table absente : ' || t
FROM unnest(ARRAY['registration_requests', 'registration_events', 'platform_admins']) AS t
WHERE to_regclass('public.' || t) IS NULL
UNION ALL
SELECT 'colonne absente : organizations.' || col
FROM unnest(ARRAY['city', 'address']) AS col
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'organizations' AND column_name = col)
UNION ALL
SELECT 'rôle « fondateur » absent ou incomplet (' || count(*) || ' permission(s) sur 4)'
FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = 'fondateur'
HAVING count(*) < 4;
