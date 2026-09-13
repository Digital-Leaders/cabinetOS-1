import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChooseOrganizationView } from './choose-organization-view';
import messages from '../../messages/fr.json';

// Ecran 2 (choix d'organisation) -- livrable de la spec : liste des
// organisations, un clic ouvre l'organisation, l'option "ouvrir directement a
// l'avenir" definit le defaut avant de rediriger.

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

const fetchMyOrganizationsMock = jest.fn();
const setDefaultOrganizationMock = jest.fn();
jest.mock('../../lib/identity-client', () => ({
  fetchMyOrganizations: (...args: unknown[]) => fetchMyOrganizationsMock(...args),
  setDefaultOrganization: (...args: unknown[]) => setDefaultOrganizationMock(...args),
}));

const setOrganizationIdMock = jest.fn();
jest.mock('../../lib/session', () => ({
  setOrganizationId: (...args: unknown[]) => setOrganizationIdMock(...args),
}));

describe('ChooseOrganizationView (comportement)', () => {
  beforeEach(() => {
    pushMock.mockClear();
    fetchMyOrganizationsMock.mockReset();
    setDefaultOrganizationMock.mockReset();
    setOrganizationIdMock.mockReset();
  });

  it('affiche la liste des organisations recuperees au montage', async () => {
    fetchMyOrganizationsMock.mockResolvedValueOnce([
      { organizationId: 'org-1', organizationName: 'Cabinet El Amrani', isDefault: false },
      { organizationId: 'org-2', organizationName: 'Clinique Al Andalous', isDefault: false },
    ]);
    render(<ChooseOrganizationView locale="fr" />);

    expect(await screen.findByText('Cabinet El Amrani')).toBeInTheDocument();
    expect(screen.getByText('Clinique Al Andalous')).toBeInTheDocument();
  });

  it('un clic simple (case non cochee) pose le cookie et redirige, sans definir de defaut', async () => {
    fetchMyOrganizationsMock.mockResolvedValueOnce([
      { organizationId: 'org-1', organizationName: 'Cabinet El Amrani', isDefault: false },
    ]);
    const user = userEvent.setup();
    render(<ChooseOrganizationView locale="fr" />);

    await user.click(await screen.findByText('Cabinet El Amrani'));

    expect(setDefaultOrganizationMock).not.toHaveBeenCalled();
    await waitFor(() => expect(setOrganizationIdMock).toHaveBeenCalledWith('org-1'));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr'));
  });

  it('case cochee : definit le defaut AVANT de rediriger', async () => {
    fetchMyOrganizationsMock.mockResolvedValueOnce([
      { organizationId: 'org-1', organizationName: 'Cabinet El Amrani', isDefault: false },
    ]);
    setDefaultOrganizationMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<ChooseOrganizationView locale="fr" />);

    await user.click(
      await screen.findByLabelText(/Ouvrir directement l'organisation choisie à l'avenir/),
    );
    await user.click(screen.getByText('Cabinet El Amrani'));

    await waitFor(() => expect(setDefaultOrganizationMock).toHaveBeenCalledWith('org-1'));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr'));
  });

  it('erreur au chargement : message clair, jamais une page vide silencieuse', async () => {
    fetchMyOrganizationsMock.mockRejectedValueOnce(new Error('network'));
    render(<ChooseOrganizationView locale="fr" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/organisations/);
  });
});
