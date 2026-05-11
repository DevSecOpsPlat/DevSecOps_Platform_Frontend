export const environment = {
  production: false,
  BASE_URL: 'http://localhost:8089/projet/', // Adjust this to your backend URL
  /** Intégrations affichées côté admin (Grafana embarqué, liens SonarCloud). */
  adminObservability: {
    grafanaEmbedUrl:
      'http://localhost/grafana/d/rYdddlPWk/node-exporter-full' +
      '?orgId=1&from=now-24h&to=now&timezone=browser' +
      '&var-ds_prometheus=prometheus&var-job=node-exporter&var-nodename=master&var-node=192.168.130.138:9100&refresh=1m',
    sonarCloudOrgUrl: 'https://sonarcloud.io/organizations/amanibennaceur-group',
    sonarCloudProjectsUrl: 'https://sonarcloud.io/organizations/amanibennaceur-group/projects'
  }
};
