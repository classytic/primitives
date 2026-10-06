/**
 * The legal form of a person or entity — what the law treats it as, for the reporting company and its
 * counterparties alike. A sole proprietorship is an `individual`: the business has no legal personality
 * of its own. Country packs decide what follows from a form (equity accounts, the year-end close, tax).
 */

export const LEGAL_FORMS = ['individual', 'partnership', 'company', 'cooperative', 'nonprofit', 'government'] as const;

export type LegalForm = (typeof LEGAL_FORMS)[number];

export const LEGAL_FORM_LABELS: Readonly<Record<LegalForm, string>> = {
  individual: 'Individual / sole proprietorship',
  partnership: 'Partnership firm',
  company: 'Company',
  cooperative: 'Cooperative society',
  nonprofit: 'Nonprofit / NGO / trust',
  government: 'Government body',
};

export function isLegalForm(value: unknown): value is LegalForm {
  return typeof value === 'string' && (LEGAL_FORMS as readonly string[]).includes(value);
}
