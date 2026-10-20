import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { users } from '../../identity';
import { roles } from '../../access-control';

export const organizations = pgTable('organizations', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // BUILD-004 etape 2, EA-018 / TASK-062 (brief R5, migration 0024) : renseignees par la cascade de
  // validation d'une inscription, depuis la demande du fondateur. NULLABLES : les organisations
  // existantes (equipe, demos) n'en ont pas.
  city: text('city'),
  address: text('address'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('memberships_user_id_idx').on(table.userId),
    index('memberships_organization_id_idx').on(table.organizationId),
    unique('memberships_user_org_unique').on(table.userId, table.organizationId),
  ],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
}));
