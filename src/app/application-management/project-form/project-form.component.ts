import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

export interface ProjectFormPayload {
  name: string;
  description?: string;
}

@Component({
  selector: 'app-managed-project-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './project-form.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class ProjectFormComponent {
  @Input() saving = false;
  @Input() error: string | null = null;
  @Output() save = new EventEmitter<ProjectFormPayload>();
  @Output() cancel = new EventEmitter<void>();

  form = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    description: new FormControl('')
  });

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.save.emit({
      name: this.form.value.name!.trim(),
      description: this.form.value.description?.trim() || undefined
    });
  }
}
