/**
 * Structured person name. Handles the parts most locales need; domains that
 * require more (per-locale honorifics, patronymics) extend from here.
 */
export interface PersonName {
  given: string;
  family: string;
  /** Middle name(s), as a single string preserving author's formatting. */
  middle?: string;
  /** Title prefix — Mr./Dr./Eng./etc. */
  prefix?: string;
  /** Suffix — Jr./Sr./PhD/etc. */
  suffix?: string;
  /** Preferred display name when it differs from formal given/family. */
  preferred?: string;
}

export function formatFullName(name: PersonName): string {
  const parts = [name.prefix, name.given, name.middle, name.family, name.suffix];
  return parts.filter((p): p is string => Boolean(p?.trim())).join(' ');
}

export function formatDisplayName(name: PersonName): string {
  if (name.preferred?.trim()) return name.preferred;
  return `${name.given} ${name.family}`.trim();
}

/**
 * Contact channels for a person. Prefer E.164 for phone when possible.
 *
 * The work-vs-personal split exists because compliance / off-boarding flows
 * (HR) distinguish them, and because marketing opt-outs are per-channel.
 */
export interface ContactInfo {
  email?: string;
  personalEmail?: string;
  phone?: string;
  alternatePhone?: string;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

/**
 * Gender as an open string — common values enumerated for tooling, but the
 * shape accepts any string to stay inclusive and locale-flexible.
 */
export type Gender = 'male' | 'female' | 'other' | 'prefer-not-to-say' | (string & {});
