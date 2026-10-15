import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import Chart from 'chart.js/auto';

import { AppModule } from './app/app.module';

// Tous les graphiques Chart.js de l'appli utilisent `responsive: true`.
// Sans amortissement, un ResizeObserver peut se re-déclencher lui-même en
// boucle (canvas → conteneur → scrollbar → conteneur → canvas...) : chaque
// cycle est peu coûteux en CPU mais ils s'enchaînent sans jamais rendre la
// main au navigateur, ce qui fige l'onglet (plus aucun clic possible) tout
// en gardant un CPU modéré. `resizeDelay` amortit ces recalculs et casse la
// boucle. Réglé une seule fois ici pour tous les charts de l'application.
Chart.defaults.resizeDelay = 200;

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));
