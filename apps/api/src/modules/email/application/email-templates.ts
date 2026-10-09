// EA-013 / TASK-050 (ADR-0020) : modeles des quatre emails de l'etape 2 (brief §5).
// Fonctions pures : parametres types -> { subject, html, text }. Aucun acces reseau,
// aucune base : testables en isolation.
//
// Separation du refus (R8, T3) : le modele "registration-refusal" ne recoit QUE le
// message destine au demandeur. Le motif interne n'est pas un parametre possible :
// il est impossible par conception de le glisser dans cet email.

export const BRAND_NAME = 'PorteSanté';

export type EmailTemplateId =
  | 'registration-confirmation'
  | 'verification-complement'
  | 'account-activation'
  | 'registration-refusal';

export interface TemplateParams {
  'registration-confirmation': { firstName: string };
  'verification-complement': {
    firstName: string;
    /** Libelle de l'information demandee (type choisi par l'admin). */
    requestedInfo: string;
    /** Message de l'admin, pre-rempli puis modifiable. */
    message: string;
  };
  'account-activation': { firstName: string; loginUrl: string };
  'registration-refusal': { firstName: string; messageToApplicant: string };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphs(value: string): string {
  return value
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

function assertHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL de connexion invalide.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('URL de connexion invalide : http ou https attendu.');
  }
  return parsed.toString();
}

function greeting(firstName: string): string {
  const name = firstName.trim();
  return name ? `Bonjour ${name},` : 'Bonjour,';
}

function layout(title: string, bodyHtml: string): string {
  return (
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">` +
    `<meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:24px;background:#F2F6F7;color:#1A2B34;line-height:1.55;` +
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
    `<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #D8DFE2;` +
    `border-radius:12px;padding:28px 28px 24px">` +
    `<div style="font-size:20px;font-weight:700;color:#0E6E78;margin-bottom:18px">${BRAND_NAME}</div>` +
    `${bodyHtml}` +
    `<p style="margin:22px 0 0;font-size:12px;color:#566169">L'équipe ${BRAND_NAME}</p>` +
    `</div></body></html>`
  );
}

const renderers: { [K in EmailTemplateId]: (params: TemplateParams[K]) => RenderedEmail } = {
  'registration-confirmation': ({ firstName }) => {
    const subject = "Votre demande d'inscription a bien été reçue";
    const lines = [
      greeting(firstName),
      "Nous avons bien reçu votre demande d'inscription. Notre équipe vérifie actuellement les informations renseignées.",
      "Vous n'avez rien à faire pour le moment. Vous recevrez un email dès que votre demande aura été traitée.",
    ];
    return {
      subject,
      html: layout(subject, lines.map((l) => paragraphs(l)).join('')),
      text: [...lines, `L'équipe ${BRAND_NAME}`].join('\n\n'),
    };
  },

  'verification-complement': ({ firstName, requestedInfo, message }) => {
    const subject = "Un complément d'information est nécessaire pour votre inscription";
    const intro = `Pour poursuivre la vérification de votre demande, nous avons besoin d'une information complémentaire : ${requestedInfo}`;
    const outro = 'Merci de répondre directement à cet email avec l\u2019information demandée.';
    return {
      subject,
      html: layout(
        subject,
        [greeting(firstName), intro, message, outro].map((l) => paragraphs(l)).join(''),
      ),
      text: [greeting(firstName), intro, message.trim(), outro, `L'équipe ${BRAND_NAME}`]
        .filter(Boolean)
        .join('\n\n'),
    };
  },

  'account-activation': ({ firstName, loginUrl }) => {
    const subject = 'Votre compte est activé';
    const url = assertHttpUrl(loginUrl);
    const intro = greeting(firstName);
    const body =
      'Votre demande a été validée et votre espace est prêt. Vous pouvez dès maintenant vous connecter.';
    const button =
      `<p style="margin:18px 0 18px"><a href="${escapeHtml(url)}" ` +
      `style="display:inline-block;background:#0E6E78;color:#FFFFFF;text-decoration:none;` +
      `font-weight:600;padding:11px 20px;border-radius:9px">Se connecter</a></p>` +
      `<p style="margin:0 0 14px;font-size:12px;color:#566169">Si le bouton ne fonctionne pas, ` +
      `copiez ce lien dans votre navigateur : ${escapeHtml(url)}</p>`;
    return {
      subject,
      html: layout(subject, paragraphs(intro) + paragraphs(body) + button),
      text: [intro, body, `Se connecter : ${url}`, `L'équipe ${BRAND_NAME}`].join('\n\n'),
    };
  },

  'registration-refusal': ({ firstName, messageToApplicant }) => {
    const subject = "Suite donnée à votre demande d'inscription";
    const intro = greeting(firstName);
    const lead = "Nous avons examiné votre demande d'inscription.";
    return {
      subject,
      html: layout(subject, [intro, lead, messageToApplicant].map((l) => paragraphs(l)).join('')),
      text: [intro, lead, messageToApplicant.trim(), `L'équipe ${BRAND_NAME}`].join('\n\n'),
    };
  },
};

export function renderEmail<T extends EmailTemplateId>(
  templateId: T,
  params: TemplateParams[T],
): RenderedEmail {
  return (renderers[templateId] as (p: TemplateParams[T]) => RenderedEmail)(params);
}
