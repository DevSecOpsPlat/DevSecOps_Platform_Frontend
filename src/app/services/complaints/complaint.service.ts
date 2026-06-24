import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';

export interface ComplaintMessageDto {
  id: string;
  authorUsername: string;
  fromAdmin: boolean;
  body: string;
  createdAt: string | null;
}

export interface ComplaintDto {
  id: string;
  authorUsername: string;
  authorEmail: string;
  subject: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  messages: ComplaintMessageDto[];
}

const API = environment.BASE_URL + 'api/';

@Injectable({
  providedIn: 'root'
})
export class ComplaintService {
  constructor(private http: HttpClient, private userService: UserService) {}

  private headers(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  getMine(): Observable<ComplaintDto[]> {
    return this.http.get<ComplaintDto[]>(API + 'complaints/mine', { headers: this.headers() });
  }

  create(subject: string, message: string): Observable<ComplaintDto> {
    return this.http.post<ComplaintDto>(API + 'complaints', { subject, message }, { headers: this.headers() });
  }

  /** Nouveau message sur une réclamation (auteur du ticket uniquement). */
  addMessage(complaintId: string, message: string): Observable<ComplaintDto> {
    return this.http.post<ComplaintDto>(
      API + `complaints/${complaintId}/messages`,
      { message },
      { headers: this.headers() }
    );
  }

  /** Fermer la discussion (auteur). */
  closeMine(complaintId: string): Observable<ComplaintDto> {
    return this.http.post<ComplaintDto>(API + `complaints/${complaintId}/close`, {}, { headers: this.headers() });
  }

  /** Liste admin (optionnel : OPEN | CLOSED). */
  listAll(status?: string): Observable<ComplaintDto[]> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.http.get<ComplaintDto[]>(API + 'admin/complaints' + q, { headers: this.headers() });
  }

  /** Message admin sur n’importe quelle réclamation. */
  adminAddMessage(complaintId: string, message: string): Observable<ComplaintDto> {
    return this.http.post<ComplaintDto>(
      API + `admin/complaints/${complaintId}/messages`,
      { message },
      { headers: this.headers() }
    );
  }

  adminClose(complaintId: string): Observable<ComplaintDto> {
    return this.http.post<ComplaintDto>(API + `admin/complaints/${complaintId}/close`, {}, { headers: this.headers() });
  }
}
