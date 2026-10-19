import HomePage from './page';

// BUILD-004 etape 2, EA-016 / TASK-057 : l'accueil redirige cote serveur un fondateur dont la
// demande n'est pas ACTIVE (session encore valide) vers son ecran de statut. Les comptes sans
// demande voient l'accueil EXACTEMENT comme avant.

const redirectMock = jest.fn((path: string) => {
  // Comme Next.js : redirect() interrompt le rendu en levant une exception speciale.
  throw new Error(`NEXT_REDIRECT:${path}`);
});
jest.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}));

const cookiesToString = jest.fn();
jest.mock('next/headers', () => ({
  cookies: async () => ({ toString: () => cookiesToString() }),
}));

jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

jest.mock('../../features/app-shell/app-header', () => ({
  AppHeader: () => null,
}));

const findStatusRedirectMock = jest.fn();
jest.mock('../../lib/registration-landing', () => ({
  findStatusRedirect: (...args: unknown[]) => findStatusRedirectMock(...args),
}));

beforeEach(() => {
  redirectMock.mockClear();
  findStatusRedirectMock.mockReset();
  cookiesToString.mockReset();
  cookiesToString.mockReturnValue('better-auth.session_token=abc');
});

describe('HomePage (TASK-057)', () => {
  it('statut non valide : redirige vers l ecran de statut, sans rien rendre', async () => {
    findStatusRedirectMock.mockResolvedValue('/ar/registration-status');

    await expect(HomePage({ params: Promise.resolve({ locale: 'ar' }) })).rejects.toThrow(
      'NEXT_REDIRECT:/ar/registration-status',
    );
    expect(redirectMock).toHaveBeenCalledWith('/ar/registration-status');
  });

  it('transmet la langue et les cookies de la requete a la verification', async () => {
    findStatusRedirectMock.mockResolvedValue(null);
    await HomePage({ params: Promise.resolve({ locale: 'fr' }) });

    expect(findStatusRedirectMock).toHaveBeenCalledWith('fr', 'better-auth.session_token=abc');
  });

  it('compte ACTIVE ou sans demande : l accueil s affiche, aucune redirection (etape 1 inchangee)', async () => {
    findStatusRedirectMock.mockResolvedValue(null);

    const page = await HomePage({ params: Promise.resolve({ locale: 'fr' }) });
    expect(page).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
