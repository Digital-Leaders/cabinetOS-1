import { Controller, Get, Module } from '@nestjs/common';
import { RequirePermission } from '../../src/modules/shared/presentation/require-permission.decorator';
import { RequireAuthentication } from '../../src/modules/shared/presentation/require-authentication.decorator';
import { CurrentUserId } from '../../src/modules/shared/presentation/current-user-id.decorator';

// Controleur jetable, reserve aux tests du Guard (TASK-016, puis ADR-0019). Ne
// fait pas partie de l application reelle -- vit dans test/fixtures/, jamais
// dans src/.

@Controller('test-guard')
export class GuardTestController {
  @Get('protected')
  @RequirePermission('read', 'members')
  protectedRoute() {
    return { data: { ok: true } };
  }

  @Get('unprotected')
  unprotectedRoute() {
    return { data: { ok: true } };
  }

  @Get('authenticated-only')
  @RequireAuthentication()
  authenticatedOnlyRoute(@CurrentUserId() userId: string) {
    return { data: { ok: true, userId } };
  }
}

@Module({ controllers: [GuardTestController] })
export class GuardTestModule {}
