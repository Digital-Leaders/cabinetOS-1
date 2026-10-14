import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { medecinSpecialtyEnum } from '../../medecin';
import { GENERALISTE, REGISTRATION_CITIES } from '../domain/registration-rules';

// TASK-052 (BUILD-004 etape 2) : formulaire d'inscription du fondateur (R1).
// Obligatoires : prenom, nom, email, mot de passe, specialite, nom de structure, ville.
// Facultatifs : INPE, numero d'Ordre, adresse -- leur absence n'empeche jamais
// l'inscription (R1, critere d'acceptation du brief).
//
// Specialite : l'une des valeurs du module Medecin (enum importe, jamais recopie) ou
// « generaliste » (ADR-0021, D7). INPE et Ordre : aucun format impose ici, coherent
// avec le module Medecin (format INPE jamais bloquant ; Ordre en texte libre) ; la
// cascade (EA-018) passera par les fonctions du module Medecin, qui normalisent.

export const REGISTRATION_SPECIALTIES = [GENERALISTE, ...medecinSpecialtyEnum.enumValues] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateRegistrationDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsIn(REGISTRATION_SPECIALTIES)
  specialty!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  inpe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  numeroOrdre?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  structureName!: string;

  @IsIn(REGISTRATION_CITIES)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}
