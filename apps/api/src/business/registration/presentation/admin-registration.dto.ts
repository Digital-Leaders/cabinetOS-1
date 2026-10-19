import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  ADMIN_FILTERS,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  type AdminFilter,
} from '../domain/admin-list';

// BUILD-004 etape 2, EA-017 / TASK-059 : parametres de l'espace admin.

export const INTERNAL_NOTE_MAX_LENGTH = 2000;

export class ListRegistrationRequestsQueryDto {
  @IsOptional()
  @IsIn(ADMIN_FILTERS)
  filter?: AdminFilter;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH * 3)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}

/**
 * Seul champ modifiable de l'espace admin en lecture : la note interne. Aucun autre champ n'est
 * accepte (ValidationPipe `whitelist` retire tout le reste) : les donnees declarees par le
 * demandeur ne peuvent pas etre reecrites par ce chemin.
 */
export class UpdateInternalNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(INTERNAL_NOTE_MAX_LENGTH)
  internalNote?: string | null;
}
