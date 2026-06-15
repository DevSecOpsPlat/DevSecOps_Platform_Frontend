export class SigninResponse {
  accessToken!: string;
  refreshToken?: string;
  id?: number | string;
  username!: string;
  email?: string;
  roles!: string[];
  tokenType!: string;
  walletAddress?: string;
  mustChangePassword?: boolean;
}
