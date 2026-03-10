import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';

const BASE = environment.BASE_URL;

@Injectable({ providedIn: 'root' })
export class SonarQubeService {

  constructor(private http: HttpClient, private userService: UserService) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  getSonarQubeResults(): Observable<any> {
    return this.http.get(BASE + 'api/sonarqube/results', {
      headers: this.authHeaders()
    });
  }

  getQualityGateStatus(): Observable<any> {
    return this.http.get(BASE + 'api/sonarqube/quality-gate', {
      headers: this.authHeaders()
    });
  }
}

