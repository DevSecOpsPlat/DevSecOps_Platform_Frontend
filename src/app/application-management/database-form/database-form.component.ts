import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import {
  AppDatabaseModel,
  DbEngine,
  DbFamily,
  DEFAULT_DB_PORTS,
  ENGINES_BY_FAMILY,
  SECRET_MASK
} from '../../models/application-management/application-management.models';

const RESOURCE_NAME = /^[a-z]([a-z0-9-]{0,48}[a-z0-9])?$/;
const LOGICAL_DB = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;
const CASSANDRA_KS = /^[a-z][a-z0-9_]{0,47}$/;
const REDIS_INDEX = /^(1[0-5]|[0-9])$/;
const ROOT_USER = /^[a-zA-Z_][a-zA-Z0-9_]{1,31}$/;
const ENGINE_VERSION = /^[0-9]+(\.[0-9]+)*([._-][a-zA-Z0-9]+)?$/;
const STORAGE_SIZE = /^[1-9][0-9]*[KMGT]i$/;
const PASSWORD_SAFE = /^[\x21-\x7E]{8,128}$/;

const RESERVED: Partial<Record<DbEngine, string[]>> = {
  POSTGRES: ['postgres', 'template0', 'template1'],
  MYSQL: ['mysql', 'sys', 'information_schema', 'performance_schema'],
  MARIADB: ['mysql', 'sys', 'information_schema', 'performance_schema'],
  MONGODB: ['admin', 'local', 'config']
};

function patternMsg(re: RegExp, message: string): ValidatorFn {
  return (c: AbstractControl): ValidationErrors | null => {
    const v = (c.value ?? '').toString().trim();
    if (!v) return null;
    return re.test(v) ? null : { patternMsg: message };
  };
}

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
  localError: string | null = null;

  form!: FormGroup;

  ngOnInit(): void {
    const db = this.database;
    const family: DbFamily = db?.dbFamily || 'SQL';
    this.availableEngines = ENGINES_BY_FAMILY[family];
    const engine: DbEngine = db?.engine || this.availableEngines[0];

    this.form = new FormGroup({
      name: new FormControl(db?.name || '', [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(50),
        patternMsg(RESOURCE_NAME, 'Minuscules, chiffres et tirets (ex. main-db)')
      ]),
      dbFamily: new FormControl(family, [Validators.required]),
      engine: new FormControl(engine, [Validators.required]),
      version: new FormControl(db?.version || '', [
        Validators.required,
        patternMsg(ENGINE_VERSION, 'Tag numérique (ex. 16, 16.2, 8.4)')
      ]),
      dbName: new FormControl(db?.dbName || (engine === 'REDIS' ? '0' : ''), [
        Validators.required,
        this.logicalDbValidator()
      ]),
      rootUser: new FormControl(db?.rootUser || this.defaultRootUser(engine), []),
      rootPassword: new FormControl(db?.hasRootPassword ? SECRET_MASK : '', []),
      exposedPort: new FormControl(db?.exposedPort || DEFAULT_DB_PORTS[engine], [
        Validators.required,
        Validators.min(1),
        Validators.max(65535)
      ]),
      storageSize: new FormControl(db?.storageSize || '1Gi', [
        Validators.required,
        patternMsg(STORAGE_SIZE, 'Format K8s : 512Mi, 1Gi, 10Gi… (max 50Gi)')
      ])
    });

    this.syncCredentialValidators(engine);

    this.form.get('dbFamily')!.valueChanges.subscribe((fam: DbFamily) => {
      this.availableEngines = ENGINES_BY_FAMILY[fam] || [];
      const first = this.availableEngines[0];
      this.form.get('engine')!.setValue(first);
    });

    this.form.get('engine')!.valueChanges.subscribe((eng: DbEngine) => {
      if (eng && DEFAULT_DB_PORTS[eng]) {
        this.form.get('exposedPort')!.setValue(DEFAULT_DB_PORTS[eng]);
      }
      if (eng === 'REDIS' && !REDIS_INDEX.test((this.form.get('dbName')!.value || '').toString())) {
        this.form.get('dbName')!.setValue('0');
      }
      if (!this.isEdit) {
        this.form.get('rootUser')!.setValue(this.defaultRootUser(eng));
      }
      this.syncCredentialValidators(eng);
      this.form.get('dbName')!.updateValueAndValidity();
    });
  }

  get isEdit(): boolean {
    return !!this.database?.id;
  }

  get engine(): DbEngine {
    return this.form?.get('engine')?.value as DbEngine;
  }

  get isRedis(): boolean {
    return this.engine === 'REDIS';
  }

  get isCassandra(): boolean {
    return this.engine === 'CASSANDRA';
  }

  /** PG / Mongo — user mappé dans l'image. MySQL/MariaDB : champ masqué (seul ROOT_PASSWORD). */
  get showRootUser(): boolean {
    return this.engine === 'POSTGRES' || this.engine === 'MONGODB';
  }

  get showRootPassword(): boolean {
    return this.engine !== 'CASSANDRA';
  }

  get passwordLabel(): string {
    if (this.isRedis) return 'Mot de passe Redis (--requirepass) *';
    return `Mot de passe root ${this.isEdit ? '' : '*'}`;
  }

  get dbNameLabel(): string {
    if (this.isRedis) return 'Index Redis *';
    if (this.isCassandra) return 'Keyspace Cassandra *';
    return 'Nom dans le moteur *';
  }

  get dbNameHint(): string {
    if (this.isRedis) return 'Index logique Redis (0–15).';
    if (this.isCassandra) {
      return 'Max 48 car., minuscules. Attention : Cassandra ne crée pas le keyspace au démarrage (Job CQL à venir).';
    }
    return 'Nom créé dans le serveur (POSTGRES_DB / MYSQL_DATABASE / …). La casse est conservée pour PostgreSQL.';
  }

  private defaultRootUser(engine: DbEngine): string {
    if (engine === 'POSTGRES' || engine === 'MONGODB') return 'app_user';
    return 'root';
  }

  private syncCredentialValidators(engine: DbEngine): void {
    const userCtrl = this.form.get('rootUser')!;
    const pwdCtrl = this.form.get('rootPassword')!;

    if (engine === 'POSTGRES' || engine === 'MONGODB') {
      userCtrl.setValidators([
        Validators.required,
        patternMsg(ROOT_USER, 'Lettres, chiffres, _ (ex. app_user)')
      ]);
    } else {
      userCtrl.clearValidators();
    }

    if (engine === 'CASSANDRA') {
      pwdCtrl.clearValidators();
    } else if (this.isEdit) {
      pwdCtrl.setValidators([this.optionalPasswordValidator()]);
    } else {
      pwdCtrl.setValidators([Validators.required, this.passwordValidator()]);
    }
    userCtrl.updateValueAndValidity({ emitEvent: false });
    pwdCtrl.updateValueAndValidity({ emitEvent: false });
  }

  private passwordValidator(): ValidatorFn {
    return (c: AbstractControl): ValidationErrors | null => {
      const v = (c.value ?? '').toString();
      if (!v || v === SECRET_MASK) return { required: true };
      if (!PASSWORD_SAFE.test(v)) {
        return { patternMsg: '8–128 caractères ASCII imprimables, sans espace' };
      }
      return null;
    };
  }

  private optionalPasswordValidator(): ValidatorFn {
    return (c: AbstractControl): ValidationErrors | null => {
      const v = (c.value ?? '').toString();
      if (!v || v === SECRET_MASK) return null;
      if (!PASSWORD_SAFE.test(v)) {
        return { patternMsg: '8–128 caractères ASCII imprimables, sans espace' };
      }
      return null;
    };
  }

  private logicalDbValidator(): ValidatorFn {
    return (c: AbstractControl): ValidationErrors | null => {
      const raw = (c.value ?? '').toString().trim();
      if (!raw) return null;
      const engine = this.form?.get('engine')?.value as DbEngine | undefined;
      if (engine === 'REDIS') {
        return REDIS_INDEX.test(raw) ? null : { patternMsg: 'Index Redis entre 0 et 15' };
      }
      const normalized = engine === 'CASSANDRA' ? raw.toLowerCase() : raw;
      if (engine === 'CASSANDRA') {
        return CASSANDRA_KS.test(normalized)
          ? null
          : { patternMsg: 'Keyspace : minuscules, max 48 car. (ex. app_ks)' };
      }
      if (!LOGICAL_DB.test(normalized)) {
        return { patternMsg: 'Commence par une lettre, puis lettres/chiffres/_ (ex. appdb)' };
      }
      const reserved = RESERVED[engine!];
      if (reserved?.includes(normalized.toLowerCase())) {
        return { patternMsg: `Nom réservé par ${engine}` };
      }
      return null;
    };
  }

  isInvalid(controlName: string): boolean {
    const c = this.form?.get(controlName);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  fieldError(controlName: string): string | null {
    const c = this.form?.get(controlName);
    if (!c || !c.errors || !(c.touched || c.dirty)) return null;
    if (c.errors['required']) return 'Champ obligatoire';
    if (c.errors['minlength']) {
      return `Minimum ${c.errors['minlength'].requiredLength} caractères`;
    }
    if (c.errors['maxlength']) return 'Trop long';
    if (c.errors['min'] || c.errors['max']) return 'Port invalide (1–65535)';
    if (c.errors['patternMsg']) return c.errors['patternMsg'] as string;
    return 'Valeur invalide';
  }

  onSubmit(): void {
    this.localError = null;
    this.syncCredentialValidators(this.engine);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.localError = 'Corrigez les champs en rouge avant d’enregistrer.';
      return;
    }
    const v = this.form.value;
    const engine = v.engine as DbEngine;
    let dbName = (v.dbName || '').trim();
    // Cassandra seulement : minuscules à l'écriture (Job CQL futur non quoté).
    // PostgreSQL : conserver la casse (entrypoint CREATE DATABASE :\"db\" quoté).
    if (engine === 'CASSANDRA') {
      dbName = dbName.toLowerCase();
    }

    const payload: AppDatabaseModel = {
      name: (v.name || '').trim(),
      dbFamily: engine === 'MONGODB' || engine === 'REDIS' || engine === 'CASSANDRA' ? 'NOSQL' : 'SQL',
      engine,
      version: (v.version || '').trim(),
      dbName,
      rootUser: this.showRootUser ? (v.rootUser || '').trim() : 'root',
      exposedPort: Number(v.exposedPort),
      storageSize: (v.storageSize || '').trim() || '1Gi'
    };

    if (this.showRootPassword) {
      if (!this.isEdit) {
        const pwd = (v.rootPassword || '').trim();
        if (!pwd || pwd === SECRET_MASK || !PASSWORD_SAFE.test(pwd)) {
          this.form.get('rootPassword')!.markAsTouched();
          this.localError = 'Mot de passe invalide (8–128 car. ASCII, sans espace).';
          return;
        }
        payload.rootPassword = pwd;
      } else if (v.rootPassword && v.rootPassword !== SECRET_MASK) {
        if (!PASSWORD_SAFE.test(v.rootPassword)) {
          this.form.get('rootPassword')!.markAsTouched();
          this.localError = 'Nouveau mot de passe invalide.';
          return;
        }
        payload.rootPassword = v.rootPassword;
      }
    }

    this.save.emit(payload);
  }
}
