export class SigninResponse {
  accessToken?: string;
  refreshToken?: string;
  id?: number | string;
  username!: string;
  email?: string;
  roles?: string[];
  tokenType?: string;
  walletAddress?: string;
  mustChangePassword?: boolean;
  totpEnabled?: boolean;
  twoFactorEnabled?: boolean;
  twoFactorMethod?: 'TOTP' | 'EMAIL' | '';
  mustEnableTwoFactor?: boolean;
  requiresTwoFactor?: boolean;
  pendingLoginId?: string;
  emailSent?: boolean;
  message?: string;
}

export interface VerifyTwoFactorPayload {
  pendingLoginId: string;
  code: string;
}

export interface TwoFactorSetupResponse {
  otpAuthUrl: string;
  secret: string;
  issuer: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  requiredForAdmin: boolean;
  enabledAt?: string;
}
