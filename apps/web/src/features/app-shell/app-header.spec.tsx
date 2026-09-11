import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader } from './app-header';
import messages from '../../messages/fr.json';

// Parcours d'acces, etape 1 -- livrable [commit] "...deconnexion qui ramene au
// login." La deconnexion vit dans le menu utilisateur du header (Ecran 3), pas
// dans LoginForm -- teste ici.

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

describe('AppHeader (comportement)', () => {
  beforeEach(() => {
    pushMock.mockClear();
    signOutMock.mockReset();
    getSessionMock.mockReset();
  });

  it('affiche le nom et l e-mail de l utilisateur une fois la session chargee', async () => {
    getSessionMock.mockResolvedValueOnce({
      session: { id: 's1', userId: 'u1', expiresAt: '2026-01-01' },
      user: { id: 'u1', name: 'Fatima Bennani', email: 'f.bennani@cabinet.ma' },
    });
    const user = userEvent.setup();
    render(<AppHeader locale="fr" />);

    await user.click(screen.getByLabelText('Menu utilisateur'));

    expect(await screen.findByText('Fatima Bennani')).toBeInTheDocument();
    expect(screen.getByText('f.bennani@cabinet.ma')).toBeInTheDocument();
  });

  it('deconnexion : appelle signOut puis redirige vers l ecran de connexion', async () => {
    getSessionMock.mockResolvedValueOnce({
      session: { id: 's1', userId: 'u1', expiresAt: '2026-01-01' },
      user: { id: 'u1', name: 'Fatima Bennani', email: 'f.bennani@cabinet.ma' },
    });
    signOutMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<AppHeader locale="fr" />);

    await user.click(screen.getByLabelText('Menu utilisateur'));
    await screen.findByText('Fatima Bennani');
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }));

    expect(signOutMock).toHaveBeenCalled();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr/login'));
  });

  it('Profil et Reglages affichent un message bientot disponible, jamais une page morte', async () => {
    getSessionMock.mockResolvedValueOnce({
      session: { id: 's1', userId: 'u1', expiresAt: '2026-01-01' },
      user: { id: 'u1', name: 'Fatima Bennani', email: 'f.bennani@cabinet.ma' },
    });
    const user = userEvent.setup();
    render(<AppHeader locale="fr" />);

    await user.click(screen.getByLabelText('Menu utilisateur'));
    await screen.findByText('Fatima Bennani');
    await user.click(screen.getByRole('button', { name: 'Mon profil' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/bientôt/);
    expect(signOutMock).not.toHaveBeenCalled();
  });
});
