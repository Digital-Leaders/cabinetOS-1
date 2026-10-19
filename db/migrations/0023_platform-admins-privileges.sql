-- BUILD-004 etape 2, EA-017 / TASK-058 (ADR-0021 P3) : privileges du role applicatif sur
-- platform_admins. Meme patron que 0003 et 0019.
--
-- ORDRE D'APPLICATION : apres la creation du role cabinetos_app (ci.yml). La CI accorde
-- SELECT, INSERT, UPDATE, DELETE sur toutes les tables (et par defaut sur les futures) ; ce
-- REVOKE doit donc passer apres.
--
-- LECTURE SEULE pour l'application : la garde n'a besoin que de savoir si un compte est
-- administrateur. Ni INSERT, ni UPDATE, ni DELETE : meme une faille de l'application
-- (injection SQL, bug) ne peut pas promouvoir un compte administrateur de plateforme. Seul le
-- script `admin:grant`, execute avec la connexion d'administration de la base
-- (ADMIN_DATABASE_URL, role postgres, proprietaire de la table), peut y ecrire (P3).
--
-- Point de vigilance (comme 0003/0019) : la table appartient au role postgres, jamais a
-- cabinetos_app ; ses privileges viennent d'un GRANT explicite sans GRANT OPTION, donc ce
-- REVOKE n'est pas contournable par un re-GRANT.

REVOKE INSERT, UPDATE, DELETE ON platform_admins FROM cabinetos_app;

-- DOWN (rollback documente, non execute automatiquement -- role postgres) :
--   GRANT INSERT, UPDATE, DELETE ON platform_admins TO cabinetos_app;
