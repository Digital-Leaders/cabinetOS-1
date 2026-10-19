export { AccessControlModule } from './access-control.module';
export {
  AccountAccessGateRegistry,
  type AccountAccessGate,
  type AccessDenial,
} from './application/account-access-gate';
export {
  roles,
  permissions,
  rolePermissions,
  rolesRelations,
  permissionsRelations,
  rolePermissionsRelations,
  platformAdmins,
} from './infrastructure/schema';
export { findAllRoles, findRoleById } from './infrastructure/role.queries';
export { findAllPermissions, findPermissionById } from './infrastructure/permission.queries';
