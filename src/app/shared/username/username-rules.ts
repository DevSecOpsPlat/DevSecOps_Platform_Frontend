export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 30;

export function validateUsername(username: string): string | null {
  const value = (username ?? '').trim();
  if (!value) {
    return 'Nom d\'utilisateur requis.';
  }
  if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) {
    return `Entre ${USERNAME_MIN_LENGTH} et ${USERNAME_MAX_LENGTH} caractères.`;
  }
  if (!/^[a-zA-Z0-9]/.test(value)) {
    return 'Doit commencer par une lettre ou un chiffre.';
  }
  if (value.length === 2) {
    if (!/^[a-zA-Z0-9]{2}$/.test(value)) {
      return 'Caractères autorisés : lettres, chiffres, point (.), tiret (-) et underscore (_).';
    }
  } else if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/.test(value)) {
    return 'Doit commencer et se terminer par une lettre ou un chiffre.';
  }
  if (/\.\./.test(value)) {
    return 'Le point (.) ne peut pas être répété.';
  }
  if (!/[a-zA-Z]/.test(value)) {
    return 'Doit contenir au moins une lettre.';
  }
  if (new Set(value).size === 1) {
    return 'Nom non valide (caractères répétés, ex. zzzzz).';
  }
  if (/(.)\1{4,}/.test(value)) {
    return 'Trop de caractères identiques consécutifs.';
  }
  return null;
}

export function isUsernameValid(username: string): boolean {
  return validateUsername(username) === null;
}
