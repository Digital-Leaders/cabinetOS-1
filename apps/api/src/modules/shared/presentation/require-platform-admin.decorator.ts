import { SetMetadata } from '@nestjs/common';

// BUILD-004 etape 2, EA-017 / TASK-058 (ADR-0021 D3) : marque un endpoint reserve a l'equipe
// CabinetOS (administrateur de plateforme), HORS de toute organisation.
//
// Distinct de :
// - @RequirePermission() : permission DANS une organisation (x-organization-id exige) ;
// - @RequireAuthentication() : session seule, aucun droit particulier.
// Un administrateur de plateforme n'est PAS pour autant membre d'une organisation : ce
// decorateur ne donne acces a aucune donnee d'organisation (la RLS s'applique comme pour
// tout le monde). Il ouvre uniquement les endpoints d'administration marques ainsi.
//
// Comme les autres, il compte comme « marquage explicite » : sans aucun des quatre
// decorateurs, PermissionsGuard refuse par defaut (TASK-016, fail-closed).

export const REQUIRE_PLATFORM_ADMIN_KEY = 'requirePlatformAdmin';
export const RequirePlatformAdmin = () => SetMetadata(REQUIRE_PLATFORM_ADMIN_KEY, true);
