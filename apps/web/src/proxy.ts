import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);
const SESSION_COOKIE = 'better-auth.session_token';

// Parcours d'acces, etape 1 -- garde de route minimale : verifie seulement la
// PRESENCE du cookie de session (httpOnly, pose par Better-Auth au sign-in), jamais
// sa validite. C est un filet de securite cote UX (eviter d afficher une page qui
// echouera de toute facon faute de session), jamais la premiere ligne de defense --
// meme principe que CurrentOrganizationId documente deja cote backend pour
// organizationId. La vraie verification (session valide + permission dans
// l organisation) reste entierement cote API (PermissionsGuard, deja en place).

function isLoginPath(pathname: string): boolean {
  return pathname.endsWith('/login');
}

export default async function middleware(request: NextRequest) {
  const intlResponse = await intlMiddleware(request);

  // next-intl a determine qu'une redirection est necessaire (typiquement : "/"
  // sans prefixe de langue) -- on la laisse faire telle quelle, la garde d'auth
  // se rejouera sur la requete suivante, une fois l'URL prefixee par la locale.
  if (intlResponse.status >= 300 && intlResponse.status < 400) {
    return intlResponse;
  }

  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const onLoginPage = isLoginPath(pathname);
  const locale = pathname.split('/')[1] || routing.defaultLocale;

  if (!hasSession && !onLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }

  if (hasSession && onLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}`;
    return NextResponse.redirect(url);
  }

  return intlResponse;
}

export const config = {
  matcher: ['/', '/(fr|ar)/:path*'],
};
