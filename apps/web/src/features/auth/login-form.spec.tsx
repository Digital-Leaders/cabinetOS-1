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

// Etape 2 (EA-017, TASK-060) : un compte sans organisation peut etre un administrateur de plateforme.
const fetchIsPlatformAdminMock = jest.fn();
jest.mock('../../lib/admin-client', () => ({
  fetchIsPlatformAdmin: (...args: unknown[]) => fetchIsPlatformAdminMock(...args),
}));

// Etape 2 (EA-016, TASK-057) : la connexion lit aussi le statut de la demande d'inscription.
const fetchRegistrationStatusMock = jest.fn();
jest.mock('../../lib/registration-status-client', () => ({
  fetchRegistrationStatus: (...args: unknown[]) => fetchRegistrationStatusMock(...args),
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
    // Par defaut : compte SANS demande (equipe, demos), donc le parcours de l'etape 1 se
    // deroule exactement comme avant -- tous les tests existants ci-dessous restent inchanges.
    fetchRegistrationStatusMock.mockReset();
    fetchRegistrationStatusMock.mockResolvedValue({ status: null });
    // Par defaut : pas administrateur de plateforme -- l'etape 1 se deroule comme avant.
    fetchIsPlatformAdminMock.mockReset();
    fetchIsPlatformAdminMock.mockResolvedValue(false);
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

  it('« Créer mon cabinet » ouvre l inscription du fondateur (etape 2, TASK-053)', async () => {
    // Etape 1 : ce repere affichait « bientot disponible ». La spec de l'etape 1 prevoyait
    // qu'il s'active avec l'etape 2, sans changer l'ecran : c'est le cas ici.
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Créer mon cabinet' }));

    expect(pushMock).toHaveBeenCalledWith('/fr/register');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

// BUILD-004 etape 2, EA-016 / TASK-057 (ADR-0021 D4) : routage apres connexion selon le statut
// de la demande d'inscription. Seul un compte ACTIVE -- ou sans demande -- entre dans
// l'application ; les autres atteignent l'ecran de statut correspondant.
describe('LoginForm -- routage selon le statut de l inscription (TASK-057)', () => {
  beforeEach(() => {
    pushMock.mockClear();
    signInWithEmailMock.mockReset();
    fetchMyOrganizationsMock.mockReset();
    setOrganizationIdMock.mockReset();
    fetchRegistrationStatusMock.mockReset();
    signInWithEmailMock.mockResolvedValue({ id: 'u1', name: 'Youssef', email: 'y@cabinet.ma' });
  });

  it.each(['PENDING_VERIFICATION', 'COMPLEMENT_REQUESTED', 'REFUSED'])(
    '%s : conduit a l ecran de statut -- aucune organisation resolue, aucune erreur affichee',
    async (status) => {
      fetchRegistrationStatusMock.mockResolvedValue({ status, maskedEmail: 'y•••••@cabinet.ma' });
      const user = userEvent.setup();
      renderForm();
      await submitValidCredentials(user);

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr/registration-status'));
      expect(pushMock).toHaveBeenCalledTimes(1);
      // Un fondateur n'a pas d'organisation : ce n'est PAS l'erreur « aucune organisation ».
      expect(fetchMyOrganizationsMock).not.toHaveBeenCalled();
      expect(setOrganizationIdMock).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('garde la langue courante vers l ecran de statut', async () => {
    fetchRegistrationStatusMock.mockResolvedValue({ status: 'PENDING_VERIFICATION' });
    const user = userEvent.setup();
    render(<LoginForm locale="ar" />);
    await user.type(screen.getByLabelText('E-mail'), 'y@cabinet.ma');
    await user.type(screen.getByLabelText('Mot de passe'), 'password1234');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/ar/registration-status'));
  });

  it('ACTIVE : le parcours de l etape 1 se deroule comme avant (ouverture directe)', async () => {
    fetchRegistrationStatusMock.mockResolvedValue({
      status: 'ACTIVE',
      maskedEmail: 'y•••••@cabinet.ma',
    });
    fetchMyOrganizationsMock.mockResolvedValue([
      { organizationId: 'org-1', organizationName: 'Cabinet Bennani', isDefault: false },
    ]);
    const user = userEvent.setup();
    renderForm();
    await submitValidCredentials(user);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr'));
    expect(setOrganizationIdMock).toHaveBeenCalledWith('org-1');
  });

  it('compte SANS demande (equipe, demos), plusieurs organisations sans defaut : ecran de choix, comme avant', async () => {
    fetchRegistrationStatusMock.mockResolvedValue({ status: null });
    fetchMyOrganizationsMock.mockResolvedValue([
      { organizationId: 'org-1', organizationName: 'A', isDefault: false },
      { organizationId: 'org-2', organizationName: 'B', isDefault: false },
    ]);
    const user = userEvent.setup();
    renderForm();
    await submitValidCredentials(user);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr/choose-organization'));
  });

  it('compte SANS demande et sans organisation : l erreur de l etape 1 est conservee', async () => {
    fetchRegistrationStatusMock.mockResolvedValue({ status: null });
    fetchMyOrganizationsMock.mockResolvedValue([]);
    const user = userEvent.setup();
    renderForm();
    await submitValidCredentials(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.Login.noOrganization);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('statut illisible : ECHEC OUVERT, le parcours de l etape 1 continue (l API refuse de toute facon les donnees a un non-ACTIVE)', async () => {
    fetchRegistrationStatusMock.mockRejectedValue(new Error('reseau'));
    fetchMyOrganizationsMock.mockResolvedValue([
      { organizationId: 'org-1', organizationName: 'Cabinet Bennani', isDefault: false },
    ]);
    const user = userEvent.setup();
    renderForm();
    await submitValidCredentials(user);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr'));
  });

  it('mauvais identifiants : le statut n est jamais lu (rien a router sans session)', async () => {
    signInWithEmailMock.mockRejectedValue(new AuthError('invalid'));
    const user = userEvent.setup();
    renderForm();
    await submitValidCredentials(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.Login.invalidCredentials);
    expect(fetchRegistrationStatusMock).not.toHaveBeenCalled();
  });
});

// BUILD-004 etape 2, EA-017 / TASK-060 : un administrateur de plateforme (equipe CabinetOS) n'a
// AUCUNE organisation. Avant, ce cas etait traite comme une erreur (« aucune organisation »).
describe('LoginForm -- administrateur de plateforme sans organisation (TASK-060)', () => {
  beforeEach(() => {
    pushMock.mockClear();
    signInWithEmailMock.mockReset();
    fetchMyOrganizationsMock.mockReset();
    setOrganizationIdMock.mockReset();
    fetchRegistrationStatusMock.mockReset();
    fetchIsPlatformAdminMock.mockReset();
    signInWithEmailMock.mockResolvedValue({ id: 'u1', name: 'Zineb', email: 'z@cabinetos.ma' });
    fetchRegistrationStatusMock.mockResolvedValue({ status: null });
  });

  it('aucune organisation + administrateur : conduit a l espace admin, sans erreur', async () => {
    fetchMyOrganizationsMock.mockResolvedValue([]);
    fetchIsPlatformAdminMock.mockResolvedValue(true);
    const user = userEvent.setup();
    renderForm();
    await submitValidCredentials(user);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr/admin'));
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(setOrganizationIdMock).not.toHaveBeenCalled();
  });

  it('garde la langue courante', async () => {
    fetchMyOrganizationsMock.mockResolvedValue([]);
    fetchIsPlatformAdminMock.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<LoginForm locale="ar" />);
    await user.type(screen.getByLabelText('E-mail'), 'z@cabinetos.ma');
    await user.type(screen.getByLabelText('Mot de passe'), 'password1234');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/ar/admin'));
  });

  it('aucune organisation + PAS administrateur : l erreur de l etape 1 est conservee', async () => {
    fetchMyOrganizationsMock.mockResolvedValue([]);
    fetchIsPlatformAdminMock.mockResolvedValue(false);
    const user = userEvent.setup();
    renderForm();
    await submitValidCredentials(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.Login.noOrganization);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'une seule organisation',
      [{ organizationId: 'org-1', organizationName: 'A', isDefault: false }],
      '/fr',
    ],
    [
      'plusieurs organisations sans defaut',
      [
        { organizationId: 'org-1', organizationName: 'A', isDefault: false },
        { organizationId: 'org-2', organizationName: 'B', isDefault: false },
      ],
      '/fr/choose-organization',
    ],
  ])(
    '%s : la question « administrateur ? » n est JAMAIS posee -- parcours de l etape 1 intact',
    async (_label, orgs, destination) => {
      fetchMyOrganizationsMock.mockResolvedValue(orgs);
      fetchIsPlatformAdminMock.mockResolvedValue(true);
      const user = userEvent.setup();
      renderForm();
      await submitValidCredentials(user);

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith(destination));
      expect(fetchIsPlatformAdminMock).not.toHaveBeenCalled();
    },
  );

  it('un fondateur non valide va a son ecran de statut : la question n est pas posee non plus', async () => {
    fetchRegistrationStatusMock.mockResolvedValue({ status: 'PENDING_VERIFICATION' });
    const user = userEvent.setup();
    renderForm();
    await submitValidCredentials(user);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr/registration-status'));
    expect(fetchIsPlatformAdminMock).not.toHaveBeenCalled();
  });
});
