import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsView } from './settings-view';
import messages from '../../messages/fr.json';

// Commit 4 (ADR-0019) : "definir un defaut, verifier qu'il s'ouvre a la connexion
// suivante, le changer, verifier la prise en compte" (spec). La partie "s'ouvre a
// la connexion suivante" est deja prouvee par resolve-organization.spec.ts (la
// resolution ne depend que du drapeau isDefault, peu importe qui l'a pose) --
// ici, on prouve que cet ecran pose bien ce meme drapeau et reflete le nouveau
// defaut sans recharger la page.

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

const fetchMyOrganizationsMock = jest.fn();
const setDefaultOrganizationMock = jest.fn();
jest.mock('../../lib/identity-client', () => ({
  fetchMyOrganizations: (...args: unknown[]) => fetchMyOrganizationsMock(...args),
  setDefaultOrganization: (...args: unknown[]) => setDefaultOrganizationMock(...args),
}));

const twoOrgs = [
  { organizationId: 'org-1', organizationName: 'Cabinet El Amrani', isDefault: true },
  { organizationId: 'org-2', organizationName: 'Clinique Al Andalous', isDefault: false },
];

describe('SettingsView (comportement)', () => {
  beforeEach(() => {
    fetchMyOrganizationsMock.mockReset();
    setDefaultOrganizationMock.mockReset();
  });

  it('affiche toutes les organisations, avec un marqueur sur le defaut actuel', async () => {
    fetchMyOrganizationsMock.mockResolvedValueOnce(twoOrgs);
    render(<SettingsView />);

    expect(await screen.findByText('Cabinet El Amrani')).toBeInTheDocument();
    expect(screen.getByText('Clinique Al Andalous')).toBeInTheDocument();
    expect(screen.getByText('Par défaut')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Définir par défaut' })).toBeInTheDocument();
  });

  it('changer le defaut : appelle setDefaultOrganization puis reflete le nouveau defaut sans recharger', async () => {
    fetchMyOrganizationsMock.mockResolvedValueOnce(twoOrgs);
    setDefaultOrganizationMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<SettingsView />);

    await screen.findByText('Cabinet El Amrani');
    await user.click(screen.getByRole('button', { name: 'Définir par défaut' }));

    expect(setDefaultOrganizationMock).toHaveBeenCalledWith('org-2');
    await waitFor(() => expect(screen.getAllByText('Par défaut')).toHaveLength(1));
    // Le NOUVEAU defaut (org-2) porte desormais le marqueur, org-1 non.
    const clinique = screen.getByText('Clinique Al Andalous').closest('.stv-org');
    expect(clinique).toHaveTextContent('Par défaut');
    expect(await screen.findByRole('status')).toHaveTextContent(/mise à jour/);
  });

  it('echec de l enregistrement : message clair, le defaut affiche reste inchange', async () => {
    fetchMyOrganizationsMock.mockResolvedValueOnce(twoOrgs);
    setDefaultOrganizationMock.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    render(<SettingsView />);

    await screen.findByText('Cabinet El Amrani');
    await user.click(screen.getByRole('button', { name: 'Définir par défaut' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Réessayez/);
    expect(screen.getAllByText('Par défaut')).toHaveLength(1);
    const amrani = screen.getByText('Cabinet El Amrani').closest('.stv-org');
    expect(amrani).toHaveTextContent('Par défaut');
  });

  it('une seule organisation : affiche une explication, jamais un bouton "Definir par defaut" inutile', async () => {
    fetchMyOrganizationsMock.mockResolvedValueOnce([
      { organizationId: 'org-solo', organizationName: 'Solo Cabinet', isDefault: false },
    ]);
    render(<SettingsView />);

    await screen.findByText('Solo Cabinet');
    expect(screen.queryByRole('button', { name: 'Définir par défaut' })).not.toBeInTheDocument();
    expect(screen.getByText(/une seule organisation/)).toBeInTheDocument();
  });

  it('erreur au chargement : message clair, jamais une page vide silencieuse', async () => {
    fetchMyOrganizationsMock.mockRejectedValueOnce(new Error('network'));
    render(<SettingsView />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/organisations/);
  });
});
