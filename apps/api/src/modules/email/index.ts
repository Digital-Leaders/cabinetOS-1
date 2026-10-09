export { EmailModule } from './email.module';
export {
  TransactionalEmailService,
  EMAIL_OPTIONS,
} from './application/transactional-email.service';
export type { EmailOptions, EmailSendResult } from './application/transactional-email.service';
export { EMAIL_SENDER, EmailDeliveryError } from './application/email-sender.port';
export type {
  EmailAddress,
  EmailMessage,
  EmailSender,
  EmailSendReceipt,
} from './application/email-sender.port';
export { renderEmail, BRAND_NAME } from './application/email-templates';
export type { EmailTemplateId, TemplateParams, RenderedEmail } from './application/email-templates';
export { InMemoryEmailSender } from './infrastructure/in-memory-email-sender.adapter';
export type { SentEmail } from './infrastructure/in-memory-email-sender.adapter';
