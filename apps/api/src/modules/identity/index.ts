export { IdentityModule } from './identity.module';
export {
  users,
  sessions,
  accounts,
  verifications,
  usersRelations,
  sessionsRelations,
  accountsRelations,
  type OrganizationMembershipSummary,
} from './infrastructure/schema';
export {
  findUserById,
  updateUser,
  softDeleteUser,
  appendOrganizationMembership,
  removeOrganizationMembership,
  findOrganizationMembershipsForUser,
  setDefaultOrganizationMembership,
} from './infrastructure/user.queries';
export type { AuthProvider, AuthenticatedIdentity } from './application/auth-provider.port';
export { AUTH_PROVIDER } from './application/auth-provider.port';
