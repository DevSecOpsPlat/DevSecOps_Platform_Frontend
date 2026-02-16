import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';
import { DeployRequest } from '../../models/environment/deploy-request';
import { DeployResponse } from '../../models/environment/deploy-response';

const BASE = environment.BASE_URL;

@Injectable({
  providedIn: 'root'
})
export class EnvironmentService {

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  deploy(request: DeployRequest): Observable<DeployResponse> {
    return this.http.post<DeployResponse>(BASE + 'api/deploy', request, {
      headers: this.authHeaders()
    });
  }
}
