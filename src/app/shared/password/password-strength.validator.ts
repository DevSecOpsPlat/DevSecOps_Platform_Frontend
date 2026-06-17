import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { isPasswordStrong } from './password-rules';

export function passwordStrengthValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value ?? '';
    if (!value) {
      return null;
    }
    return isPasswordStrong(value) ? null : { passwordStrength: true };
  };
}
