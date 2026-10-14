import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SharedModule, DatabaseService } from '../src/modules/shared';
import { IdentityModule, AUTH_PROVIDER, type AuthProvider } from '../src/modules/identity';
import { authPool } from '../src/modules/identity/infrastructure/auth';
import { createTeamAccount } from './team-account';

// Usage (voir scripts/README.md) :
//   TEAM_ACCOUNT_PASSWORD='...' pnpm --filter @cabinetos/api run account:create -- \
//     --email prenom.nom@exemple.ma --name "Prenom Nom" --organization <uuid> --role <uuid>
// Le mot de passe passe par une variable d'environnement, jamais en argument (il
// resterait dans l'historique du terminal).

@Module({ imports: [SharedModule, IdentityModule] })
class TeamAccountScriptModule {}

function readArg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) {
    throw new Error(`Argument manquant : --${name}`);
  }
  return value;
}

async function main() {
  const password = process.env.TEAM_ACCOUNT_PASSWORD;
  if (!password) throw new Error('Variable TEAM_ACCOUNT_PASSWORD manquante.');

  const app = await NestFactory.createApplicationContext(TeamAccountScriptModule, {
    logger: ['error', 'warn'],
  });
  try {
    const { userId } = await createTeamAccount(
      {
        authProvider: app.get<AuthProvider>(AUTH_PROVIDER),
        databaseService: app.get(DatabaseService),
      },
      {
        email: readArg('email'),
        name: readArg('name'),
        organizationId: readArg('organization'),
        roleId: readArg('role'),
        password,
      },
    );
    console.log(`Compte d'equipe cree : ${userId} (adhesion et trace d'audit enregistrees).`);
  } finally {
    await app.close();
    await authPool.end();
  }
}

main().catch((error: Error) => {
  console.error(`Echec : ${error.message}`);
  process.exitCode = 1;
});
