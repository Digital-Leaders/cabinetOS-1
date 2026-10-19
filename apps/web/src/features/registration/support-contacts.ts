// TASK-055 : contacts d'aide de l'ecran de statut (brief §5.2 : « WhatsApp / telephone »).
// Les numeros ne sont pas fixes par le brief : ils viennent de la configuration, jamais du
// code. Un contact non configure n'est pas affiche -- pas de lien mort.
//
//   NEXT_PUBLIC_SUPPORT_WHATSAPP : numero international sans « + » ni espaces (ex. 2126XXXXXXXX)
//   NEXT_PUBLIC_SUPPORT_PHONE    : numero au format international (ex. +2125XXXXXXXX)

export interface SupportContacts {
  whatsappUrl: string | null;
  phoneUrl: string | null;
}

export function getSupportContacts(
  env: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPPORT_WHATSAPP: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP,
    NEXT_PUBLIC_SUPPORT_PHONE: process.env.NEXT_PUBLIC_SUPPORT_PHONE,
  },
): SupportContacts {
  const whatsapp = env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.replace(/[^0-9]/g, '');
  const phone = env.NEXT_PUBLIC_SUPPORT_PHONE?.replace(/[^0-9+]/g, '');
  return {
    whatsappUrl: whatsapp ? `https://wa.me/${whatsapp}` : null,
    phoneUrl: phone ? `tel:${phone}` : null,
  };
}
