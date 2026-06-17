import { Component, Input } from '@angular/core';
import { PASSWORD_RULES, PasswordRule, passwordRuleState, PasswordRuleState } from './password-rules';

@Component({
  selector: 'app-password-requirements',
  templateUrl: './password-requirements.component.html',
  styleUrls: ['./password-requirements.component.css']
})
export class PasswordRequirementsComponent {
  @Input() password = '';

  readonly rules = PASSWORD_RULES;

  state(rule: PasswordRule): PasswordRuleState {
    return passwordRuleState(this.password, rule);
  }
}
