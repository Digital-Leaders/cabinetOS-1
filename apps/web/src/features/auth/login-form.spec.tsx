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

function renderForm() {
  return render(<LoginForm locale="fr" />);
}

describe('LoginForm (comportement)', () => {
  beforeEach(() => {
    pushMock.mockClear();
    signInWithEmailMock.mockReset();
  });

  it('refuse la soumission sans e-mail ni mot de passe et surligne les deux champs', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(signInWithEmailMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('E-mail').closest('.lf-field')).toHaveClass('error');
    expect(screen.getByLabelText('Mot de passe').closest('.lf-field')).toHaveClass('error');
  });

  it('connexion reussie : appelle signInWithEmail et redirige vers l accueil', async () => {
    signInWithEmailMock.mockResolvedValueOnce({ id: 'u1', name: 'Fatima', email: 'f@cabinet.ma' });
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('E-mail'), 'f@cabinet.ma');
    await user.type(screen.getByLabelText('Mot de passe'), 'password1234');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(signInWithEmailMock).toHaveBeenCalledWith('f@cabinet.ma', 'password1234');
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr'));
  });

  it('echec sur mauvais identifiants : message clair dans l interface, jamais une erreur brute', async () => {
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
    signInWithEmailMock.mockRejectedValueOnce(new Error('fetch failed'));
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('E-mail'), 'f@cabinet.ma');
    await user.type(screen.getByLabelText('Mot de passe'), 'password1234');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

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
