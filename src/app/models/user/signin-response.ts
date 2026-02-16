export class SigninResponse {
  accessToken!: string;
  refreshToken?: string;
  id?: number;
  username!: string;
  email?: string;
  roles!: string[];
  tokenType!: string;
  walletAddress?: string;
}
