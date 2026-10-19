import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { SharedModule } from '../src/modules/shared';
import { IdentityModule, AUTH_PROVIDER, type AuthProvider } from '../src/modules/identity';
import { authPool } from '../src/modules/identity/infrastructure/auth';
import { grantPlatformAdmin } from './platform-admin';

// Usage (voir scripts/README.md) :
//   ADMIN_DATABASE_URL='postgres://...' [TEAM_ACCOUNT_PASSWORD='...'] \
//   pnpm --filter @cabinetos/api run admin:grant -- \
//     --email prenom.nom@exemple.ma --granted-by "Prenom Nom" --reason "co-fondateur, validation des inscriptions" \
//     [--name "Prenom Nom"]      # seulement si le compte n'existe pas encore
//
// ADMIN_DATABASE_URL : connexion d'administration de la base (role proprietaire des tables),
// distincte de DATABASE_URL (role applicatif, SANS droit d'ecriture sur platform_admins).
// Le mot de passe passe par l'environnement, jamais en argument (historique du terminal).

@Module({ imports: [SharedModule, IdentityModule] })
class GrantPlatformAdminScriptModule {}

function readArg(name: string, required = true): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) {
    if (required) throw new Error(`Argument manquant : --${name}`);
    return undefined;
  }
  return value;
}

async function main() {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (!adminUrl) {
    throw new Error(
      "Variable ADMIN_DATABASE_URL manquante : l'ecriture dans platform_admins exige la connexion d'administration de la base, pas celle de l'application.",
    );
  }

  const adminPool = new Pool({ connectionString: adminUrl });
  const app = await NestFactory.createApplicationContext(GrantPlatformAdminScriptModule, {
    logger: ['error', 'warn'],
  });
  try {
    const grantedBy = readArg('granted-by')!;
    const reason = readArg('reason')!;
    const result = await grantPlatformAdmin(
      { authProvider: app.get<AuthProvider>(AUTH_PROVIDER), adminDb: adminPool },
      {
        email: readArg('email')!,
        grantedBy,
        reason,
        name: readArg('name', false),
        password: process.env.TEAM_ACCOUNT_PASSWORD,
      },
    );
    const trace = `ajoute par "${grantedBy}", raison : "${reason}"`;
    console.log(
      result.outcome === 'ALREADY_ADMIN'
        ? `Deja administrateur de plateforme : ${result.userId} (aucune modification).`
        : `Administrateur de plateforme ${result.accountCreated ? 'cree' : 'promu'} : ${result.userId} -- ${trace}.`,
    );
  } finally {
    await app.close();
    await authPool.end();
    await adminPool.end();
  }
}

main().catch((error: Error) => {
  console.error(`Echec : ${error.message}`);
  process.exitCode = 1;
});
