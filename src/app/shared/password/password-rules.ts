export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'lower', label: 'Une lettre minuscule', test: p => /[a-z]/.test(p) },
  { id: 'upper', label: 'Une lettre majuscule', test: p => /[A-Z]/.test(p) },
  { id: 'digit', label: 'Un chiffre', test: p => /\d/.test(p) },
  { id: 'length', label: '8 caractères minimum', test: p => p.length >= 8 }
];

export function isPasswordStrong(password: string): boolean {
  return PASSWORD_RULES.every(rule => rule.test(password ?? ''));
}

export type PasswordRuleState = 'pending' | 'met' | 'unmet';

export function passwordRuleState(password: string, rule: PasswordRule): PasswordRuleState {
  if (!password) {
    return 'pending';
  }
  return rule.test(password) ? 'met' : 'unmet';
}
