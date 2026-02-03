/** Payload for POST /auth/register – must match backend User fields (username, password, email). */
export interface RegisterPayload {
  username: string;
  password: string;
  email: string;
}
