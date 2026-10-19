import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, primaryKey, unique } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { sql } from 'drizzle-orm';
import { check } from 'drizzle-orm/pg-core';
import { users } from '../../identity';

// Decision Decision Gate : Role est global (les memes roles pour toutes les organisations).
// Permission est structuree en deux champs separes : action + ressource.

export const roles = pgTable('roles', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique('permissions_action_resource_unique').on(table.action, table.resource)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

// BUILD-004 etape 2, EA-017 / TASK-058 (ADR-0021 D3, P3) : administrateurs de PLATEFORME
// (l'equipe CabinetOS qui valide les inscriptions). Table GLOBALE, sans RLS : c'est la seule
// table qui transcende l'isolation des organisations -- un administrateur de plateforme n'a
// aucune organisation. Elle ne donne acces qu'aux endpoints @RequirePlatformAdmin().
//
// INVARIANT (ADR-0021 P3) : tant que l'etape 2-bis n'existe pas, un administrateur n'est
// ajoute QUE par le script documente `admin:grant`, qui trace qui l'a ajoute et pourquoi. Le
// role applicatif (cabinetos_app) n'a que SELECT sur cette table (migration 0023) : meme une
// faille de l'application ne peut pas promouvoir un compte. La trace (granted_by, reason,
// granted_at) est exigee par la base elle-meme (CHECK), pas seulement par le script.
//
// Un retrait n'efface pas la ligne : revoked_at la conserve (trace), et la garde ignore les
// lignes revoquees. Voir le README du script pour la procedure.
export const platformAdmins = pgTable(
  'platform_admins',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id),
    grantedAt: timestamp('granted_at').defaultNow().notNull(),
    // Qui a ajoute cet administrateur (operateur humain, saisi a l'execution du script).
    grantedBy: text('granted_by').notNull(),
    // Pourquoi (ex. « co-fondateur, validation des inscriptions »).
    reason: text('reason').notNull(),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [
    check('platform_admins_granted_by_check', sql`length(btrim(${table.grantedBy})) > 0`),
    check('platform_admins_reason_check', sql`length(btrim(${table.reason})) > 0`),
  ],
);
