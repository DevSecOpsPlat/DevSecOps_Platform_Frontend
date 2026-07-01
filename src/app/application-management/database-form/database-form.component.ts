import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  AppDatabaseModel,
  DbEngine,
  DbFamily,
  DEFAULT_DB_PORTS,
  ENGINES_BY_FAMILY,
  SECRET_MASK
} from '../../models/application-management/application-management.models';

@Component({
  selector: 'app-managed-database-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './database-form.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class DatabaseFormComponent implements OnInit {
  @Input() database: AppDatabaseModel | null = null;
  @Input() saving = false;
  @Input() error: string | null = null;
  @Output() save = new EventEmitter<AppDatabaseModel>();
  @Output() cancel = new EventEmitter<void>();

  families: DbFamily[] = ['SQL', 'NOSQL'];
  availableEngines: DbEngine[] = ENGINES_BY_FAMILY['SQL'];

  form!: FormGroup;

  ngOnInit(): void {
    const db = this.database;
    const family: DbFamily = db?.dbFamily || 'SQL';
    this.availableEngines = ENGINES_BY_FAMILY[family];
    const engine: DbEngine = db?.engine || this.availableEngines[0];

    this.form = new FormGroup({
      name: new FormControl(db?.name || '', [Validators.required]),
      dbFamily: new FormControl(family, [Validators.required]),
      engine: new FormControl(engine, [Validators.required]),
      version: new FormControl(db?.version || '', [Validators.required]),
      dbName: new FormControl(db?.dbName || '', [Validators.required]),
      rootUser: new FormControl(db?.rootUser || 'root', [Validators.required]),
      rootPassword: new FormControl(db?.hasRootPassword ? SECRET_MASK : ''),
      exposedPort: new FormControl(db?.exposedPort || DEFAULT_DB_PORTS[engine], [Validators.required]),
      storageSize: new FormControl(db?.storageSize || '1Gi', [Validators.required])
    });

    this.form.get('dbFamily')!.valueChanges.subscribe((fam: DbFamily) => {
      this.availableEngines = ENGINES_BY_FAMILY[fam] || [];
      const first = this.availableEngines[0];
      this.form.get('engine')!.setValue(first);
    });

    this.form.get('engine')!.valueChanges.subscribe((eng: DbEngine) => {
      if (eng && DEFAULT_DB_PORTS[eng]) {
        this.form.get('exposedPort')!.setValue(DEFAULT_DB_PORTS[eng]);
      }
    });
  }

  get isEdit(): boolean {
    return !!this.database?.id;
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.value;
    const payload: AppDatabaseModel = {
      name: v.name,
      dbFamily: v.dbFamily,
      engine: v.engine,
      version: v.version,
      dbName: v.dbName,
      rootUser: v.rootUser,
      exposedPort: v.exposedPort,
      storageSize: v.storageSize
    };
    // N'envoie le mot de passe que s'il a été modifié (jamais la valeur masquée).
    if (v.rootPassword && v.rootPassword !== SECRET_MASK) {
      payload.rootPassword = v.rootPassword;
    }
    this.save.emit(payload);
  }
}
