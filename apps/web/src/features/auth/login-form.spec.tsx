import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './login-form';
import { AuthError } from '../../lib/auth-client';
import messages from '../../messages/fr.json';

// Parcours d'acces, etape 1 -- livrable [commit] "parcours d'authentification...
// Avec les tests de comportement : connexion reussie, echec sur mauvais
// identifiants (message clair, pas de 500 brut), deconnexion qui ramene au login."
// La deconnexion est testee dans app-header.spec.tsx (elle vit dans le header, pas
// dans ce formulaire).
//
// Commit 2 (ADR-0019) : la resolution d'organisation apres connexion (les 3 cas)
// est testee ici au niveau de l integration LoginForm -> redirection ; la logique
// pure elle-meme (resolveOrganization) est testee independamment dans
// resolve-organization.spec.ts.

function getNested(obj: unknown, path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], obj);
  return typeof value === 'string' ? value : path;
}

jest.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) =>
    getNested((messages as Record<string, unknown>)[namespace], key),
}));

const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const signInWithEmailMock = jest.fn();
jest.mock('../../lib/auth-client', () => {
  const actual = jest.requireActual('../../lib/auth-client');
  return {
    ...actual,
    signInWithEmail: (...args: unknown[]) => signInWithEmailMock(...args),
  };
});

const fetchMyOrganizationsMock = jest.fn();
jest.mock('../../lib/identity-client', () => ({
  fetchMyOrganizations: (...args: unknown[]) => fetchMyOrganizationsMock(...args),
}));

const setOrganizationIdMock = jest.fn();
jest.mock('../../lib/session', () => ({
  setOrganizationId: (...args: unknown[]) => setOrganizationIdMock(...args),
}));

function renderForm() {
  return render(<LoginForm locale="fr" />);
}

async function submitValidCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('E-mail'), 'f@cabinet.ma');
  await user.type(screen.getByLabelText('Mot de passe'), 'password1234');
  await user.click(screen.getByRole('button', { name: 'Se connecter' }));
}

describe('LoginForm (comportement)', () => {
  beforeEach(() => {
    pushMock.mockClear();
    signInWithEmailMock.mockReset();
    fetchMyOrganizationsMock.mockReset();
    setOrganizationIdMock.mockReset();
    signInWithEmailMock.mockResolvedValue({ id: 'u1', name: 'Fatima', email: 'f@cabinet.ma' });
  });

  it('refuse la soumission sans e-mail ni mot de passe et surligne les deux champs', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(signInWithEmailMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('E-mail').closest('.lf-field')).toHaveClass('error');
    expect(screen.getByLabelText('Mot de passe').closest('.lf-field')).toHaveClass('error');
  });

  it('cas 1 -- une seule organisation : pose le cookie et redirige directement vers l accueil', async () => {
    fetchMyOrganizationsMock.mockResolvedValueOnce([
      { organizationId: 'org-1', organizationName: 'Cabinet Solo', isDefault: false },
    ]);
    const user = userEvent.setup();
    renderForm();

    await submitValidCredentials(user);

    expect(signInWithEmailMock).toHaveBeenCalledWith('f@cabinet.ma', 'password1234');
    await waitFor(() => expect(setOrganizationIdMock).toHaveBeenCalledWith('org-1'));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr'));
  });

  it('cas 2 -- plusieurs organisations avec un defaut : pose le cookie du defaut, redirige vers l accueil', async () => {
    fetchMyOrganizationsMock.mockResolvedValueOnce([
      { organizationId: 'org-1', organizationName: 'Cabinet A', isDefault: false },
      { organizationId: 'org-2', organizationName: 'Cabinet B', isDefault: true },
    ]);
    const user = userEvent.setup();
    renderForm();

    await submitValidCredentials(user);

    await waitFor(() => expect(setOrganizationIdMock).toHaveBeenCalledWith('org-2'));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr'));
  });

  it('cas 3 -- plusieurs organisations, aucun defaut : redirige vers l ecran de choix, sans poser de cookie', async () => {
    fetchMyOrganizationsMock.mockResolvedValueOnce([
      { organizationId: 'org-1', organizationName: 'Cabinet A', isDefault: false },
      { organizationId: 'org-2', organizationName: 'Cabinet B', isDefault: false },
    ]);
    const user = userEvent.setup();
    renderForm();

    await submitValidCredentials(user);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr/choose-organization'));
    expect(setOrganizationIdMock).not.toHaveBeenCalled();
  });

  it('echec sur mauvais identifiants : message clair dans l interface, jamais une erreur brute', async () => {
    signInWithEmailMock.mockReset();
    signInWithEmailMock.mockRejectedValueOnce(
      new AuthError('Invalid email or password', 'INVALID_EMAIL_OR_PASSWORD'),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('E-mail'), 'f@cabinet.ma');
    await user.type(screen.getByLabelText('Mot de passe'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-mail ou mot de passe incorrect. Réessayez.',
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('erreur inattendue (reseau, 500) : message generique, jamais le detail technique', async () => {
    signInWithEmailMock.mockReset();
    signInWithEmailMock.mockRejectedValueOnce(new Error('fetch failed'));
    const user = userEvent.setup();
    renderForm();

    await submitValidCredentials(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Une erreur inattendue est survenue. Réessayez.',
    );
  });

  it('« Mot de passe oublié » affiche un message bientot disponible, jamais une page morte', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Mot de passe oublié ?' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/bientôt/);
    expect(signInWithEmailMock).not.toHaveBeenCalled();
  });

  it('« Créer mon cabinet » affiche un message bientot disponible, jamais une page morte', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Créer mon cabinet' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/bientôt/);
  });
});
