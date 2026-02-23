import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';

export interface PendingUser {
  id: string;
  username: string;
  email: string;
  accountStatus: string;
  createdAt: string;
}

const BASE = environment.BASE_URL + 'api/admin/';

@Injectable({
  providedIn: 'root'
})
export class AdminService {

  constructor(private http: HttpClient, private userService: UserService) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  getPendingUsers(): Observable<PendingUser[]> {
    return this.http.get<PendingUser[]>(BASE + 'pending-users', { headers: this.authHeaders() });
  }

  approveUser(id: string): Observable<void> {
    return this.http.post<void>(BASE + `${id}/approve`, {}, { headers: this.authHeaders() });
  }

  rejectUser(id: string, reason?: string): Observable<void> {
    const body = reason ? { reason } : {};
    return this.http.post<void>(BASE + `${id}/reject`, body, { headers: this.authHeaders() });
  }
}

