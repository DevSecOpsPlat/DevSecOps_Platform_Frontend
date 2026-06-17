import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { validateUsername } from './username-rules';

export function usernameValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value ?? '';
    if (!String(value).trim()) {
      return null;
    }
    const message = validateUsername(value);
    return message ? { usernameInvalid: { message } } : null;
  };
}
