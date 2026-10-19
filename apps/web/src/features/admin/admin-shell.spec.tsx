import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminShell } from './admin-shell';
import { AdminApiError } from '../../lib/admin-client';
import { translate } from './admin-test-utils';
import messages from '../../messages/fr.json';

// BUILD-004 etape 2, EA-017 / TASK-060 : la coque de l'espace admin. Rien de l'espace n'est
// affiche avant que le serveur ait confirme que l'utilisateur est administrateur de la plateforme.

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, values?: Record<string, string | number>) =>
    translate(messages as Record<string, unknown>, ns, key, values),
}));

const pushMock = jest.fn();
const replaceMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

const fetchAdminMeMock = jest.fn();
jest.mock('../../lib/admin-client', () => {
  const actual = jest.requireActual('../../lib/admin-client');
  return { ...actual, fetchAdminMe: () => fetchAdminMeMock() };
});

const signOutMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../lib/auth-client', () => ({ signOut: () => signOutMock() }));

const a = messages.Admin;
const child = jest.fn(() => <p>contenu de l espace admin</p>);
function Child() {
  return child();
}

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
  fetchAdminMeMock.mockReset();
  signOutMock.mockClear();
  child.mockClear();
});

describe('AdminShell (TASK-060)', () => {
  it('administrateur : la barre de la maquette (marque + pastille) et le contenu s affichent', async () => {
    fetchAdminMeMock.mockResolvedValue(undefined);
    render(
      <AdminShell locale="fr">
        <Child />
      </AdminShell>,
    );

    expect(await screen.findByText('contenu de l espace admin')).toBeInTheDocument();
    expect(screen.getByText(a.badge)).toBeInTheDocument();
    expect(screen.getByText('Cabinet')).toBeInTheDocument();
  });

  it('RIEN n est monte tant que le serveur n a pas repondu : le contenu ne peut pas lancer d appel admin', async () => {
    let resolve!: () => void;
    fetchAdminMeMock.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    render(
      <AdminShell locale="fr">
        <Child />
      </AdminShell>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(a.loading);
    expect(child).not.toHaveBeenCalled();
    resolve();
    await screen.findByText('contenu de l espace admin');
  });

  it('compte non administrateur (403) : « Acces reserve », et AUCUN element de l espace admin', async () => {
    fetchAdminMeMock.mockRejectedValue(new AdminApiError('FORBIDDEN'));
    render(
      <AdminShell locale="fr">
        <Child />
      </AdminShell>,
    );

    expect(await screen.findByRole('heading', { name: a.forbidden.title })).toBeInTheDocument();
    expect(screen.getByText(a.forbidden.body)).toBeInTheDocument();
    expect(child).not.toHaveBeenCalled();
    expect(screen.queryByText(a.badge)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: a.logout })).not.toBeInTheDocument();
  });

  it('« Retour a l accueil » ramene a l accueil de la langue courante', async () => {
    fetchAdminMeMock.mockRejectedValue(new AdminApiError('FORBIDDEN'));
    const user = userEvent.setup();
    render(
      <AdminShell locale="ar">
        <Child />
      </AdminShell>,
    );
    await user.click(await screen.findByRole('button', { name: a.forbidden.home }));
    expect(pushMock).toHaveBeenCalledWith('/ar');
  });

  it('session absente ou expiree (401) : retour a la connexion, rien n est affiche', async () => {
    fetchAdminMeMock.mockRejectedValue(new AdminApiError('UNAUTHENTICATED'));
    render(
      <AdminShell locale="fr">
        <Child />
      </AdminShell>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/fr/login'));
    expect(child).not.toHaveBeenCalled();
  });

  it('panne : message clair, « Reessayer » relit l acces', async () => {
    fetchAdminMeMock
      .mockRejectedValueOnce(new AdminApiError('UNEXPECTED'))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(
      <AdminShell locale="fr">
        <Child />
      </AdminShell>,
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(child).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: a.retry }));
    expect(await screen.findByText('contenu de l espace admin')).toBeInTheDocument();
  });

  it('« Se deconnecter » ferme la session puis ramene a la connexion', async () => {
    fetchAdminMeMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <AdminShell locale="fr">
        <Child />
      </AdminShell>,
    );
    await user.click(await screen.findByRole('button', { name: a.logout }));

    expect(signOutMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr/login'));
  });

  it('l acces n est verifie qu une fois, pas a chaque rendu', async () => {
    fetchAdminMeMock.mockResolvedValue(undefined);
    const { rerender } = render(
      <AdminShell locale="fr">
        <Child />
      </AdminShell>,
    );
    await screen.findByText('contenu de l espace admin');
    rerender(
      <AdminShell locale="fr">
        <Child />
      </AdminShell>,
    );
    expect(fetchAdminMeMock).toHaveBeenCalledTimes(1);
  });
});
