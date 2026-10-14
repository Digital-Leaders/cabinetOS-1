import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/modules/identity/infrastructure/schema.ts',
    './src/modules/organization/infrastructure/schema.ts',
    './src/modules/access-control/infrastructure/schema.ts',
    './src/modules/audit/infrastructure/schema.ts',
    './src/modules/notifications/infrastructure/schema.ts',
    './src/modules/settings/infrastructure/schema.ts',
    './src/modules/storage/infrastructure/schema.ts',
    './src/business/patient/infrastructure/schema.ts',
    './src/business/medecin/infrastructure/schema.ts',
    './src/business/registration/infrastructure/schema.ts',
  ],
  out: '../../db/migrations',
  dbCredentials: {
    url: 'postgres://fake:fake@localhost:5432/fake',
  },
});
