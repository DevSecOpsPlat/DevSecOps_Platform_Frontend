import { Component } from '@angular/core';
import { ThemeService } from './services/ui/theme.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  constructor(themeService: ThemeService) {
    themeService.init();
  }
}
