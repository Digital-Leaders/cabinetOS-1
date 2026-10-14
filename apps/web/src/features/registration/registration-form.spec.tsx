import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegistrationForm } from './registration-form';
import { RegistrationError } from '../../lib/registration-client';
import { SPECIALTY_CODES } from './registration-options';
import messages from '../../messages/fr.json';

// TASK-053 (BUILD-004 etape 2) : comportement de l'ecran d'inscription. Le serveur
// revalide tout (TASK-052) ; ici on prouve que l'ecran aide sans bloquer au-dela du
// necessaire, envoie exactement les donnees declarees, et traduit chaque reponse du
// serveur en message clair -- jamais une erreur brute.

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

const submitRegistrationMock = jest.fn();
jest.mock('../../lib/registration-client', () => {
  const actual = jest.requireActual('../../lib/registration-client');
  return {
    ...actual,
    submitRegistration: (...args: unknown[]) => submitRegistrationMock(...args),
  };
});

const fr = messages.Registration;

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(fr.labels.firstName), 'Youssef');
  await user.type(screen.getByLabelText(fr.labels.lastName), 'Bennani');
  await user.type(screen.getByLabelText(fr.labels.email), 'y.bennani@cabinet.ma');
  await user.type(screen.getByLabelText(fr.labels.password), 'password1234');
  await user.selectOptions(screen.getByLabelText(fr.labels.specialty), 'cardiologie');
  await user.type(screen.getByLabelText(fr.labels.structureName), 'Cabinet Dr Bennani');
  await user.selectOptions(screen.getByLabelText(fr.labels.city), 'Casablanca');
}

function submit(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: fr.submit }));
}

beforeEach(() => {
  pushMock.mockReset();
  submitRegistrationMock.mockReset();
});

describe('RegistrationForm (TASK-053)', () => {
  it('montre une page, trois blocs et un seul bouton, comme la maquette', () => {
    render(<RegistrationForm locale="fr" />);
    expect(screen.getByRole('heading', { level: 1, name: fr.title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: fr.blocks.you })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: fr.blocks.activity })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: fr.blocks.cabinet })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: fr.submit })).toHaveLength(1);
    expect(screen.getByLabelText(fr.labels.firstName)).toHaveFocus();
  });

  it('propose « Medecin generaliste » en tete, puis les 35 specialites de la liste validee', () => {
    render(<RegistrationForm locale="fr" />);
    const options = within(screen.getByLabelText(fr.labels.specialty)).getAllByRole('option');
    expect(options).toHaveLength(1 + SPECIALTY_CODES.length);
    expect(options[1]).toHaveTextContent('Médecin généraliste');
    expect(options[1]).toHaveValue('generaliste');
    expect(SPECIALTY_CODES).toHaveLength(36);
    expect(options.map((o) => o.getAttribute('value'))).not.toContain('medecine_generale');
  });

  it('signale les champs obligatoires vides, sans rien envoyer', async () => {
    const user = userEvent.setup();
    render(<RegistrationForm locale="fr" />);
    await submit(user);

    expect(screen.getByRole('alert')).toHaveTextContent(fr.errors.checkFields);
    for (const label of [
      fr.labels.firstName,
      fr.labels.lastName,
      fr.labels.email,
      fr.labels.password,
      fr.labels.specialty,
      fr.labels.structureName,
      fr.labels.city,
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    }
    // INPE, numero d'Ordre et adresse ne sont jamais signales : ils sont facultatifs (R1).
    expect(screen.getByLabelText(/INPE/)).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/N° d'Ordre/)).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(fr.labels.address)).not.toHaveAttribute('aria-invalid', 'true');
    expect(submitRegistrationMock).not.toHaveBeenCalled();
  });

  it('signale un email mal forme et un mot de passe trop court', async () => {
    const user = userEvent.setup();
    render(<RegistrationForm locale="fr" />);
    await fillRequired(user);
    await user.clear(screen.getByLabelText(fr.labels.email));
    await user.type(screen.getByLabelText(fr.labels.email), 'pas-un-email');
    await user.clear(screen.getByLabelText(fr.labels.password));
    await user.type(screen.getByLabelText(fr.labels.password), 'court');
    await submit(user);

    expect(screen.getByText(fr.errors.emailInvalid)).toBeInTheDocument();
    expect(screen.getByText(fr.errors.passwordTooShort)).toBeInTheDocument();
    expect(submitRegistrationMock).not.toHaveBeenCalled();
  });

  it('INPE, numero d Ordre et adresse absents n empechent pas l envoi (R1)', async () => {
    submitRegistrationMock.mockResolvedValue({ id: 'r1', status: 'PENDING_VERIFICATION' });
    const user = userEvent.setup();
    render(<RegistrationForm locale="fr" />);
    await fillRequired(user);
    await submit(user);

    await waitFor(() => expect(submitRegistrationMock).toHaveBeenCalledTimes(1));
    expect(submitRegistrationMock).toHaveBeenCalledWith({
      firstName: 'Youssef',
      lastName: 'Bennani',
      email: 'y.bennani@cabinet.ma',
      password: 'password1234',
      specialty: 'cardiologie',
      structureName: 'Cabinet Dr Bennani',
      city: 'Casablanca',
    });
  });

  it('envoie les champs facultatifs renseignes, espaces retires, sans format impose', async () => {
    submitRegistrationMock.mockResolvedValue({ id: 'r2', status: 'PENDING_VERIFICATION' });
    const user = userEvent.setup();
    render(<RegistrationForm locale="fr" />);
    await fillRequired(user);
    await user.type(screen.getByLabelText(/INPE/), ' 12AB ');
    await user.type(screen.getByLabelText(/N° d'Ordre/), 'ORD-42');
    await user.type(screen.getByLabelText(fr.labels.address), '12 rue des Orangers');
    await submit(user);

    await waitFor(() =>
      expect(submitRegistrationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          inpe: '12AB',
          numeroOrdre: 'ORD-42',
          address: '12 rue des Orangers',
        }),
      ),
    );
  });

  it('apres envoi : confirmation affichee, le formulaire disparait', async () => {
    submitRegistrationMock.mockResolvedValue({ id: 'r3', status: 'PENDING_VERIFICATION' });
    const user = userEvent.setup();
    render(<RegistrationForm locale="fr" />);
    await fillRequired(user);
    await submit(user);

    expect(await screen.findByRole('status')).toHaveTextContent(fr.done.title);
    expect(screen.queryByRole('button', { name: fr.submit })).not.toBeInTheDocument();
  });

  it('email deja utilise : message neutre et champ email signale, rien d autre', async () => {
    submitRegistrationMock.mockRejectedValue(new RegistrationError('EMAIL_ALREADY_USED'));
    const user = userEvent.setup();
    render(<RegistrationForm locale="fr" />);
    await fillRequired(user);
    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.emailAlreadyUsed);
    expect(screen.getByLabelText(fr.labels.email)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(fr.labels.firstName)).not.toHaveAttribute('aria-invalid', 'true');
    // Les saisies sont conservees : rien a retaper.
    expect(screen.getByLabelText(fr.labels.structureName)).toHaveValue('Cabinet Dr Bennani');
  });

  it('refus du serveur (400) : invite a verifier les champs, jamais une erreur brute', async () => {
    submitRegistrationMock.mockRejectedValue(new RegistrationError('INVALID'));
    const user = userEvent.setup();
    render(<RegistrationForm locale="fr" />);
    await fillRequired(user);
    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.checkFields);
  });

  it('panne inattendue : message clair, le bouton redevient utilisable', async () => {
    submitRegistrationMock.mockRejectedValue(new Error('reseau'));
    const user = userEvent.setup();
    render(<RegistrationForm locale="fr" />);
    await fillRequired(user);
    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.unexpected);
    expect(screen.getByRole('button', { name: fr.submit })).toBeEnabled();
  });

  it('pendant l envoi, le bouton est desactive (pas de double soumission)', async () => {
    let resolve!: (value: unknown) => void;
    submitRegistrationMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<RegistrationForm locale="fr" />);
    await fillRequired(user);
    await submit(user);

    expect(screen.getByRole('button', { name: fr.submitting })).toBeDisabled();
    resolve({ id: 'r4', status: 'PENDING_VERIFICATION' });
    await screen.findByRole('status');
  });

  it('« Se connecter » ramene a l ecran de connexion de la langue courante', async () => {
    const user = userEvent.setup();
    render(<RegistrationForm locale="ar" />);
    await user.click(screen.getByRole('button', { name: fr.signIn }));
    expect(pushMock).toHaveBeenCalledWith('/ar/login');
  });
});
