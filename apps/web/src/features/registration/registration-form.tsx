'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { submitRegistration, RegistrationError } from '../../lib/registration-client';
import { SPECIALTY_CODES, REGISTRATION_CITIES } from './registration-options';
import './registration-form.css';

// TASK-053 (BUILD-004 etape 2, EA-014) : ecran d'inscription du fondateur -- port fidele
// de docs/design (maquette inscription.html) et du brief §5.1 : une page, trois blocs
// courts, un seul bouton. Specialite et ville en listes controlees ; INPE, numero d'Ordre
// et adresse facultatifs (R1).
//
// Regle non negociable n°3 : les validations aident, elles ne bloquent pas au-dela du
// strict necessaire. Cote navigateur, seuls les champs OBLIGATOIRES vides, un email sans
// forme d'email et un mot de passe trop court sont signales -- exactement ce que le
// serveur refuserait de toute facon (TASK-052, qui revalide tout). Aucun format n'est
// impose a l'INPE ni au numero d'Ordre.
//
// Apres l'envoi : la session du fondateur est ouverte par la reponse du serveur ; il est
// conduit a l'ecran de statut (TASK-055), qui affiche la variante de son statut reel.

type FieldName =
  'firstName' | 'lastName' | 'email' | 'password' | 'specialty' | 'structureName' | 'city';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function RegistrationForm({ locale }: { locale: string }) {
  const t = useTranslations('Registration');
  const router = useRouter();

  const [values, setValues] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    specialty: '',
    inpe: '',
    numeroOrdre: '',
    structureName: '',
    city: '',
    address: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function validate(): Partial<Record<FieldName, string>> {
    const errors: Partial<Record<FieldName, string>> = {};
    const required: FieldName[] = [
      'firstName',
      'lastName',
      'email',
      'password',
      'specialty',
      'structureName',
      'city',
    ];
    for (const name of required) {
      if (values[name].trim() === '') errors[name] = t('errors.required');
    }
    if (!errors.email && !EMAIL_SHAPE.test(values.email.trim())) {
      errors.email = t('errors.emailInvalid');
    }
    if (!errors.password && values.password.length < MIN_PASSWORD_LENGTH) {
      errors.password = t('errors.passwordTooShort');
    }
    return errors;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError(t('errors.checkFields'));
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      await submitRegistration({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
        password: values.password,
        specialty: values.specialty,
        structureName: values.structureName.trim(),
        city: values.city,
        ...(values.inpe.trim() ? { inpe: values.inpe.trim() } : {}),
        ...(values.numeroOrdre.trim() ? { numeroOrdre: values.numeroOrdre.trim() } : {}),
        ...(values.address.trim() ? { address: values.address.trim() } : {}),
      });
      router.push(`/${locale}/registration-status`);
    } catch (error) {
      const kind = error instanceof RegistrationError ? error.kind : 'UNEXPECTED';
      if (kind === 'EMAIL_ALREADY_USED') {
        setFieldErrors({ email: t('errors.emailAlreadyUsedField') });
        setFormError(t('errors.emailAlreadyUsed'));
      } else if (kind === 'INVALID') {
        setFormError(t('errors.checkFields'));
      } else {
        setFormError(t('errors.unexpected'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fieldClass(name: FieldName) {
    return `rf-field${fieldErrors[name] ? ' error' : ''}`;
  }

  function errorText(name: FieldName) {
    const message = fieldErrors[name];
    return message ? (
      <p className="rf-field-error" id={`rf-${name}-error`}>
        {message}
      </p>
    ) : null;
  }

  function describedBy(name: FieldName) {
    return fieldErrors[name] ? `rf-${name}-error` : undefined;
  }

  return (
    <div className="rf-shell">
      <div className="rf-card">
        <Brand />
        <h1>{t('title')}</h1>
        <p className="rf-sub">{t('subtitle')}</p>

        {formError && (
          <div className="rf-form-error" role="alert">
            <span aria-hidden>⚠</span>
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <section className="rf-block" aria-labelledby="rf-block-you">
            <h2 className="rf-btitle" id="rf-block-you">
              <span className="rf-dot" aria-hidden />
              {t('blocks.you')}
            </h2>
            <div className="rf-row">
              <div className={fieldClass('firstName')}>
                <label htmlFor="rf-firstName">{t('labels.firstName')}</label>
                <input
                  id="rf-firstName"
                  type="text"
                  autoComplete="given-name"
                  autoFocus
                  placeholder={t('placeholders.firstName')}
                  value={values.firstName}
                  onChange={(e) => update('firstName', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.firstName)}
                  aria-describedby={describedBy('firstName')}
                />
                {errorText('firstName')}
              </div>
              <div className={fieldClass('lastName')}>
                <label htmlFor="rf-lastName">{t('labels.lastName')}</label>
                <input
                  id="rf-lastName"
                  type="text"
                  autoComplete="family-name"
                  placeholder={t('placeholders.lastName')}
                  value={values.lastName}
                  onChange={(e) => update('lastName', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.lastName)}
                  aria-describedby={describedBy('lastName')}
                />
                {errorText('lastName')}
              </div>
            </div>
            <div className={fieldClass('email')}>
              <label htmlFor="rf-email">{t('labels.email')}</label>
              <input
                id="rf-email"
                type="email"
                autoComplete="email"
                dir="ltr"
                placeholder={t('placeholders.email')}
                value={values.email}
                onChange={(e) => update('email', e.target.value)}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={describedBy('email')}
              />
              {errorText('email')}
            </div>
            <div className={fieldClass('password')}>
              <label htmlFor="rf-password">{t('labels.password')}</label>
              <input
                id="rf-password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={values.password}
                onChange={(e) => update('password', e.target.value)}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={describedBy('password')}
              />
              {errorText('password')}
            </div>
          </section>

          <section className="rf-block" aria-labelledby="rf-block-activity">
            <h2 className="rf-btitle" id="rf-block-activity">
              <span className="rf-dot" aria-hidden />
              {t('blocks.activity')}
            </h2>
            <div className={fieldClass('specialty')}>
              <label htmlFor="rf-specialty">{t('labels.specialty')}</label>
              <select
                id="rf-specialty"
                value={values.specialty}
                onChange={(e) => update('specialty', e.target.value)}
                aria-invalid={Boolean(fieldErrors.specialty)}
                aria-describedby={describedBy('specialty')}
              >
                <option value="">{t('selectPlaceholder')}</option>
                {SPECIALTY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {t(`specialties.${code}`)}
                  </option>
                ))}
              </select>
              {errorText('specialty')}
            </div>
            <div className="rf-row">
              <div className="rf-field">
                <label htmlFor="rf-inpe">
                  {t('labels.inpe')}
                  <span className="rf-opt">{t('optional')}</span>
                </label>
                <input
                  id="rf-inpe"
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  placeholder={t('placeholders.inpe')}
                  value={values.inpe}
                  onChange={(e) => update('inpe', e.target.value)}
                />
              </div>
              <div className="rf-field">
                <label htmlFor="rf-numeroOrdre">
                  {t('labels.numeroOrdre')}
                  <span className="rf-opt">{t('optional')}</span>
                </label>
                <input
                  id="rf-numeroOrdre"
                  type="text"
                  dir="ltr"
                  placeholder="—"
                  value={values.numeroOrdre}
                  onChange={(e) => update('numeroOrdre', e.target.value)}
                />
              </div>
            </div>
            <p className="rf-hint">{t('hints.identifiers')}</p>
          </section>

          <section className="rf-block" aria-labelledby="rf-block-cabinet">
            <h2 className="rf-btitle" id="rf-block-cabinet">
              <span className="rf-dot" aria-hidden />
              {t('blocks.cabinet')}
            </h2>
            <div className={fieldClass('structureName')}>
              <label htmlFor="rf-structureName">{t('labels.structureName')}</label>
              <input
                id="rf-structureName"
                type="text"
                autoComplete="organization"
                placeholder={t('placeholders.structureName')}
                value={values.structureName}
                onChange={(e) => update('structureName', e.target.value)}
                aria-invalid={Boolean(fieldErrors.structureName)}
                aria-describedby={describedBy('structureName')}
              />
              {errorText('structureName')}
            </div>
            <div className="rf-row">
              <div className={fieldClass('city')}>
                <label htmlFor="rf-city">{t('labels.city')}</label>
                <select
                  id="rf-city"
                  value={values.city}
                  onChange={(e) => update('city', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.city)}
                  aria-describedby={describedBy('city')}
                >
                  <option value="">{t('selectPlaceholder')}</option>
                  {REGISTRATION_CITIES.map((city) => (
                    <option key={city} value={city}>
                      {t(`cities.${city}`)}
                    </option>
                  ))}
                </select>
                {errorText('city')}
              </div>
              <div className="rf-field">
                {/* Facultative (R1) ; la maquette ne la marque pas « facultatif » : on suit
                    la maquette pour l'apparence, et rien ne l'exige a l'envoi. */}
                <label htmlFor="rf-address">{t('labels.address')}</label>
                <input
                  id="rf-address"
                  type="text"
                  autoComplete="street-address"
                  placeholder={t('placeholders.address')}
                  value={values.address}
                  onChange={(e) => update('address', e.target.value)}
                />
              </div>
            </div>
          </section>

          <p className="rf-reassure">{t('reassure')}</p>

          <button type="submit" className="rf-btn" disabled={submitting}>
            {submitting ? t('submitting') : t('submit')}
          </button>
        </form>

        <div className="rf-foot">
          {t('haveAccount')}{' '}
          <button type="button" className="rf-link" onClick={() => router.push(`/${locale}/login`)}>
            {t('signIn')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="rf-brand">
      <span className="b1">Cabinet</span>
      <span className="b2">OS</span>
    </div>
  );
}
