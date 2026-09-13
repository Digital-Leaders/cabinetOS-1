import { SetMetadata } from '@nestjs/common';

// Parcours d'acces, etape 1, commit 2 (ADR-0019) : marque un endpoint comme
// necessitant une session valide, SANS contexte d'organisation -- le cas de la
// resolution d'organisation elle-meme (lister/choisir une organisation), ou
// aucune organisation n est encore selectionnee. Distinct de :
// - @Public() : aucune session verifiee non plus ;
// - @RequirePermission() : exige en plus x-organization-id et une permission.
// Sans aucun des trois decorateurs, PermissionsGuard refuse par defaut (TASK-016).

export const REQUIRE_AUTHENTICATION_KEY = 'requireAuthentication';
export const RequireAuthentication = () => SetMetadata(REQUIRE_AUTHENTICATION_KEY, true);
