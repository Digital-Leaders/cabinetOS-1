import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  COMPLEMENT_INFO_TYPES,
  MAX_COMPLEMENT_MESSAGE_LENGTH,
  MAX_OTHER_INFO_LENGTH,
  type ComplementInfoType,
} from '../domain/complement-rules';
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

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Demande de complement (TASK-064, brief R7). Le TYPE d'information est un choix ferme ; « autre » exige sa
 * precision. Le message est celui que l'administrateur a edite : il est envoye tel quel et conserve (ADR-0022).
 */
export class RequestComplementDto {
  @IsIn(COMPLEMENT_INFO_TYPES)
  infoType!: ComplementInfoType;

  // Exigee seulement pour « autre » ; ignoree pour les deux types predefinis (le libelle est fixe).
  @ValidateIf((o: RequestComplementDto) => o.infoType === 'other')
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_OTHER_INFO_LENGTH)
  otherInfo?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_COMPLEMENT_MESSAGE_LENGTH)
  message!: string;
}
