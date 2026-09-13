import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader } from './app-header';
import messages from '../../messages/fr.json';

// Parcours d'acces, etape 1 -- livrable [commit] "...deconnexion qui ramene au
// login." La deconnexion vit dans le menu utilisateur du header (Ecran 3), pas
// dans LoginForm -- teste ici.
//
// Commit 3 : le selecteur d'organisation. Le test le plus important du
// changement d'organisation (l'etancheite reelle, cote API) vit dans
// tests/isolation/organization-switch-isolation.spec.ts -- ici, on teste
// seulement le comportement du composant (rechargement complet apres bascule,
// jamais une navigation cote client qui laisserait un etat React survivre).

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

const getSessionMock = jest.fn();
const signOutMock = jest.fn();
jest.mock('../../lib/auth-client', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  signOut: (...args: unknown[]) => signOutMock(...args),
}));

const fetchMyOrganizationsMock = jest.fn();
jest.mock('../../lib/identity-client', () => ({
  fetchMyOrganizations: (...args: unknown[]) => fetchMyOrganizationsMock(...args),
}));

const getOrganizationIdMock = jest.fn();
const setOrganizationIdMock = jest.fn();
jest.mock('../../lib/session', () => ({
  getOrganizationId: (...args: unknown[]) => getOrganizationIdMock(...args),
  setOrganizationId: (...args: unknown[]) => setOrganizationIdMock(...args),
}));

const hardNavigateMock = jest.fn();
jest.mock('../../lib/navigation', () => ({
  hardNavigate: (...args: unknown[]) => hardNavigateMock(...args),
}));

const twoOrgs = [
  { organizationId: 'org-1', organizationName: 'Cabinet El Amrani', isDefault: true },
  { organizationId: 'org-2', organizationName: 'Clinique Al Andalous', isDefault: false },
];

describe('AppHeader (comportement)', () => {
  beforeEach(() => {
    pushMock.mockClear();
    signOutMock.mockReset();
    getSessionMock.mockReset();
    fetchMyOrganizationsMock.mockReset();
    getOrganizationIdMock.mockReset();
    setOrganizationIdMock.mockReset();
    hardNavigateMock.mockReset();
    getSessionMock.mockResolvedValue({
      session: { id: 's1', userId: 'u1', expiresAt: '2026-01-01' },
      user: { id: 'u1', name: 'Fatima Bennani', email: 'f.bennani@cabinet.ma' },
    });
    fetchMyOrganizationsMock.mockResolvedValue(twoOrgs);
    getOrganizationIdMock.mockReturnValue('org-1');
  });

  it('affiche le nom et l e-mail de l utilisateur une fois la session chargee', async () => {
    const user = userEvent.setup();
    render(<AppHeader locale="fr" />);

    await user.click(screen.getByLabelText('Menu utilisateur'));

    expect(await screen.findByText('Fatima Bennani')).toBeInTheDocument();
    expect(screen.getByText('f.bennani@cabinet.ma')).toBeInTheDocument();
  });

  it('deconnexion : appelle signOut puis redirige vers l ecran de connexion', async () => {
    signOutMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<AppHeader locale="fr" />);

    await user.click(screen.getByLabelText('Menu utilisateur'));
    await screen.findByText('Fatima Bennani');
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }));

    expect(signOutMock).toHaveBeenCalled();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr/login'));
  });

  it('Profil affiche un message bientot disponible, jamais une page morte', async () => {
    const user = userEvent.setup();
    render(<AppHeader locale="fr" />);

    await user.click(screen.getByLabelText('Menu utilisateur'));
    await screen.findByText('Fatima Bennani');
    await user.click(screen.getByRole('button', { name: 'Mon profil' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/bientôt/);
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('Reglages navigue vers l ecran reel (commit 4), jamais un message bientot disponible', async () => {
    const user = userEvent.setup();
    render(<AppHeader locale="fr" />);

    await user.click(screen.getByLabelText('Menu utilisateur'));
    await screen.findByText('Fatima Bennani');
    await user.click(screen.getByRole('button', { name: 'Réglages' }));

    expect(pushMock).toHaveBeenCalledWith('/fr/settings');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('affiche l organisation courante dans le selecteur', async () => {
    render(<AppHeader locale="fr" />);
    expect(await screen.findByText('Cabinet El Amrani')).toBeInTheDocument();
  });

  it('ouvre le menu et liste toutes les organisations, la courante cochee', async () => {
    const user = userEvent.setup();
    render(<AppHeader locale="fr" />);

    await screen.findByText('Cabinet El Amrani');
    await user.click(screen.getByText('Cabinet El Amrani'));

    expect(screen.getByText("Changer d'organisation")).toBeInTheDocument();
    expect(screen.getAllByText('Cabinet El Amrani')).toHaveLength(2); // bouton + item du menu
    expect(screen.getByText('Clinique Al Andalous')).toBeInTheDocument();
  });

  it('choisir une AUTRE organisation pose le cookie puis recharge completement la page (jamais une navigation client)', async () => {
    const user = userEvent.setup();
    render(<AppHeader locale="fr" />);

    await screen.findByText('Cabinet El Amrani');
    await user.click(screen.getByText('Cabinet El Amrani'));
    await user.click(screen.getByText('Clinique Al Andalous'));

    expect(setOrganizationIdMock).toHaveBeenCalledWith('org-2');
    await waitFor(() => expect(hardNavigateMock).toHaveBeenCalledWith('/fr'));
    expect(pushMock).not.toHaveBeenCalledWith('/fr'); // pas de router.push, un vrai rechargement
  });

  it('re-choisir l organisation deja active ne recharge rien', async () => {
    const user = userEvent.setup();
    render(<AppHeader locale="fr" />);

    await screen.findByText('Cabinet El Amrani');
    await user.click(screen.getAllByText('Cabinet El Amrani')[0]);
    await user.click(screen.getAllByText('Cabinet El Amrani')[1]);

    expect(setOrganizationIdMock).not.toHaveBeenCalled();
    expect(hardNavigateMock).not.toHaveBeenCalled();
  });
});
