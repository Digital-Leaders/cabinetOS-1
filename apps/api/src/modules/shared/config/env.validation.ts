import * as Joi from 'joi';

// Validation stricte des variables d environnement critiques (Section N / TASK-019).
// L application refuse de demarrer si l une d elles est absente ou invalide.
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  DATABASE_URL: Joi.string().uri().required(),
  PORT: Joi.number().default(3000),
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  BETTER_AUTH_BASE_URL: Joi.string().uri().default('http://localhost:3000'),

  // E-mail transactionnel (EA-013, ADR-0020). Hors production, "memory" par defaut :
  // rien ne part reellement. En production, "brevo" est obligatoire -- jamais un
  // envoi silencieusement perdu. La cle API est un secret : lue ici, jamais en dur.
  EMAIL_PROVIDER: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().valid('brevo').required(),
    otherwise: Joi.string().valid('brevo', 'memory').default('memory'),
  }),
  BREVO_API_KEY: Joi.when('EMAIL_PROVIDER', {
    is: 'brevo',
    then: Joi.string().min(10).required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  EMAIL_FROM_ADDRESS: Joi.string().email().default('noreply@portesante.ma'),
  EMAIL_FROM_NAME: Joi.string().default('PorteSanté'),
  EMAIL_REPLY_TO: Joi.string().email().default('verification@portesante.ma'),
});
