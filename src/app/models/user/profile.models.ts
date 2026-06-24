export interface UserProfile {
  id: string;
  username: string;
  email: string;
  roles: string[];
  accountStatus: string;
  createdAt?: string | null;
  twoFactorEnabled?: boolean;
  totpEnabled?: boolean;
  twoFactorMethod?: 'TOTP' | 'EMAIL' | null;
  mustEnableTwoFactor?: boolean;
}

export interface UpdateEmailPayload {
  email: string;
  currentPassword: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}
