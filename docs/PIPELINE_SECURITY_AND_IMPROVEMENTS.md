# Pipeline DevSecOps – Revue et améliorations

Ce document évalue le pipeline GitLab CI/CD (stages hello → report) tel que défini, indique s’il couvre tous types de projets et vulnérabilités, et propose des **corrections** (syntaxe YAML, URL backend) ainsi que des **améliorations** optionnelles.

---

## 1. Vue d’ensemble du pipeline actuel

| Stage    | Job(s)                 | Outil(s)                          | Rôle principal                         | Artifact(s) |
|----------|------------------------|------------------------------------|----------------------------------------|-------------|
| hello    | hello-world            | echo                               | Vérification env                       | —           |
| clone    | clone-repository       | git + détection                    | Clone + BUILD_TOOL, FRAMEWORK, Dockerfile | `user-repo/`, `build.env` |
| sonarqube| sonarqube-scan         | SonarScanner                       | Qualité / SAST (SonarCloud)            | — (rapport sur SonarCloud) |
| sca      | trivy-scan             | Trivy FS                           | Vulnérabilités fichiers / dépendances | `reports/trivy.json` |
| sca      | owasp-dependency-check | OWASP Dependency-Check            | Dépendances (multi-langage)            | `reports/owasp/` |
| sca      | npm-audit              | npm audit                          | Dépendances Node                       | `reports/npm-audit.json` |
| sast     | safe-analysis          | SAFE CLI                           | SAST Angular                           | `reports/sast/` |
| secrets  | gitleaks-secrets       | Gitleaks                           | Secrets dans le code                   | `reports/secrets/` |
| container| grype-scan             | Grype                              | Scan image Docker (si Dockerfile)      | `reports/container/` |
| iac      | checkov-scan           | Checkov                            | Scan IaC                               | `reports/iac/` |
| license  | license-scan           | licensecheck (Python)              | Licences des dépendances               | `reports/license/` |
| report   | notify-results         | curl                               | Notification backend                   | `reports/` (agrégat) |

---

## 2. Couverture par type de projet

| Type de projet        | Détection actuelle     | Scanné aujourd’hui                                      | Manques éventuels |
|-----------------------|------------------------|---------------------------------------------------------|-------------------|
| **Node (Angular)**    | package.json + angular.json | Trivy, OWASP, NPM, SAFE, SonarQube, Gitleaks, Grype, Checkov, license | — |
| **Node (React/Vue)**  | package.json           | Trivy, OWASP, NPM, SonarQube, Gitleaks, Grype, Checkov, license | SAST dédié (SAFE skippe) |
| **Java/Maven**        | —                      | Trivy, OWASP, Gitleaks, Grype, Checkov, license         | Détection pom.xml ; SAST Java (FindSecBugs) |
| **Python**            | —                      | Trivy, OWASP (partiel), Gitleaks, Grype, Checkov, license | Détection requirements.txt ; pip audit / safety |
| **Go**                | —                      | Trivy, Gitleaks, Grype, Checkov, license                | Détection go.mod ; gosec |
| **Avec Dockerfile**   | HAS_DOCKERFILE (clone) | Grype sur l’image buildée                               | — |
| **Avec IaC**          | —                      | Checkov sur tout le repo                                | — |

**Conclusion :** Le pipeline couvre bien **Node (surtout Angular), projets avec Dockerfile et IaC**. Pour viser « tous types de projets », il manque : **détection Python/Go/Java** dans clone + jobs conditionnels (pip audit, gosec, etc.) et **SAST multi-langage** (ex. Semgrep) pour React/Vue/backend.

---

## 3. Couverture par type de vulnérabilité

| Catégorie           | Outil(s)              | Couverture |
|---------------------|------------------------|------------|
| Dépendances (SCA)   | Trivy, OWASP, NPM      | Bonne (Node + générique) |
| Code (SAST)         | SonarQube, SAFE (Angular) | Bonne pour Angular ; partielle pour le reste |
| Secrets             | Gitleaks               | Bonne |
| Container           | Grype                  | Bonne si Dockerfile |
| IaC                 | Checkov                | Bonne |
| Licences            | licensecheck           | Bonne (Python deps) ; pour Node voir section 5 |
| DAST                | —                      | Non prévu (nécessite app déployée) |

**Conclusion :** La plateforme couvre bien **SCA, secrets, container, IaC, licences** et **SAST pour Angular**. Pour « toutes vulnérabilités » dans le code : ajouter **SAST multi-langage** (Semgrep) et **audits dédiés** (pip, gosec) selon types de projets.

---

## 4. Corrections à appliquer (syntaxe et configuration)

### 4.1 SonarQube – une seule commande

En YAML, chaque `-` dans `script` est une **nouvelle** commande. Les arguments sur les lignes suivantes sont donc interprétés comme des commandes séparées (et échouent). Il faut une **seule** ligne pour `sonar-scanner` :

**À corriger :**
```yaml
script:
  - sonar-scanner
    -Dsonar.projectKey="..."   # ❌ Nouvelle commande, invalide
```

**Correction :**
```yaml
sonarqube-scan:
  stage: sonarqube
  image: sonarsource/sonar-scanner-cli:latest
  needs: ["clone-repository"]
  script:
    - echo "SonarQube Scan"
    - sonar-scanner -Dsonar.projectKey="amanibennaceur-group_EnviroTest" -Dsonar.organization="amanibennaceur-group" -Dsonar.sources=user-repo -Dsonar.host.url="https://sonarcloud.io" -Dsonar.token="$SONAR_TOKEN" -Dsonar.exclusions="**/node_modules/**,**/dist/**" || true
  allow_failure: true
```

Variables à définir en CI/CD GitLab : `SONAR_TOKEN`.

---

### 4.2 OWASP Dependency-Check – une seule commande

Même principe : une seule invocation avec tous les arguments.

**À corriger :**
```yaml
script:
  - ./dependency-check/bin/dependency-check.sh
    --project "$ENVIRONMENT_ID"    # ❌ Nouvelle commande
    --format JSON
    ...
```

**Correction :**
```yaml
script:
  - echo "OWASP Dependency-Check"
  - mkdir -p reports
  - ./dependency-check/bin/dependency-check.sh --project "$ENVIRONMENT_ID" --format JSON --out reports/owasp --scan user-repo || true
```

Le rapport est souvent dans `reports/owasp/dependency-check-report.json` (ou avec timestamp). Adapter le backend pour lire ce chemin si besoin.

---

### 4.3 Report – URL du backend en variable

`http://localhost:8089` n’est **pas** utilisable depuis le runner GitLab (localhost = machine du runner, pas la vôtre). Il faut une URL accessible (variable CI).

**À corriger :**
```yaml
- curl -X POST "http://localhost:8089/projet/api/deploy" ...
```

**Correction :**
```yaml
script:
  - echo "📧 Envoi des notifications"
  - |
    curl -X POST "${BACKEND_URL}/projet/api/deploy" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${API_TOKEN}" \
      -d '{
        "status": "completed",
        "environment_id": "'"$ENVIRONMENT_ID"'",
        "pipeline_id": "'"$CI_PIPELINE_ID"'",
        "reports_url": "'"$CI_JOB_URL"'/artifacts"
      }' || echo "⚠️ Notification échouée"
  - echo "✅ Pipeline terminé"
```

À définir en **Variables CI/CD** du projet GitLab :
- `BACKEND_URL` : ex. `https://votre-backend.com` (sans slash final)
- `API_TOKEN` : token pour l’API backend

Vérifier que le chemin (`/projet/api/deploy`) correspond bien à votre backend ; si votre API est sous `/api/...`, adapter.

---

### 4.4 Report – besoin de SonarQube dans `needs` (optionnel)

Si vous voulez que le job `notify-results` ait accès à tous les artifacts (y compris un éventuel rapport SonarQube généré côté job), vous pouvez ajouter `sonarqube-scan` dans `needs`. Aujourd’hui SonarQube n’envoie pas de fichier en artifact (tout est sur SonarCloud), donc ce n’est pas obligatoire.

---

## 5. Améliorations optionnelles

### 5.1 Détection multi-langage dans clone

Pour mieux couvrir « tous types de projets », dans le job **clone-repository** vous pouvez ajouter :

```yaml
- test -f "user-repo/package.json" && echo "BUILD_TOOL=node" >> build.env || true
- test -f "user-repo/requirements.txt" && echo "BUILD_TOOL=python" >> build.env || true
- test -f "user-repo/go.mod" && echo "BUILD_TOOL=go" >> build.env || true
- test -f "user-repo/pom.xml" && echo "BUILD_TOOL=maven" >> build.env || true
- test -f "user-repo/Dockerfile" && echo "HAS_DOCKERFILE=true" >> build.env || true
# Angular
- |
  if [ -f "user-repo/angular.json" ]; then
    echo "FRAMEWORK=angular" >> build.env
  fi
- cat build.env
```

Ensuite vous pouvez ajouter des jobs conditionnels (pip audit pour Python, gosec pour Go, etc.) avec `rules: - if: ...`.

---

### 5.2 Licence pour Node (licensecheck est Python)

Aujourd’hui **license-scan** utilise `licensecheck` (Python) : il scanne les dépendances **Python**. Pour les projets **Node**, un outil dédié est plus adapté, par exemple :

- **license-checker** (npm) : `npx license-checker --json > reports/license/license-node.json` (à lancer seulement si `package.json` existe).

Vous pouvez soit :
- ajouter un second job `license-scan-node` (stage license) qui tourne si `BUILD_TOOL=node`,  
soit  
- dans le même job, brancher : si `user-repo/package.json` → `license-checker`, sinon → `licensecheck` (Python).

---

### 5.3 SAST multi-langage (Semgrep)

Pour couvrir React, Vue, Java, Python, Go, etc., un SAST générique comme **Semgrep** complète bien SonarQube et SAFE :

```yaml
semgrep-scan:
  stage: sast
  image: returntocorp/semgrep:latest
  needs: ["clone-repository"]
  script:
    - mkdir -p reports/sast
    - semgrep scan --config auto --json -o reports/sast/semgrep.json user-repo || true
  artifacts:
    paths:
      - reports/sast/
  allow_failure: true
```

Penser à ajouter `semgrep-scan` dans les `needs` de `notify-results` si vous voulez inclure ce rapport.

---

### 5.4 Python : pip audit / safety

Si vous détectez `BUILD_TOOL=python` dans clone, ajouter un job SCA Python :

```yaml
pip-audit:
  stage: sca
  image: python:3.11-alpine
  needs: ["clone-repository"]
  script:
    - pip install pip-audit
    - mkdir -p reports
    - |
      if [ -f "user-repo/requirements.txt" ]; then
        cd user-repo
        pip-audit --format json > ../reports/pip-audit.json || true
        cd ..
      else
        echo '{"skipped": true}' > reports/pip-audit.json
      fi
  artifacts:
    paths:
      - reports/pip-audit.json
  allow_failure: true
```

---

## 6. Fichier pipeline corrigé (extraits)

Les blocs ci-dessous remplacent **uniquement** les parties à corriger (SonarQube, OWASP, notify-results). Le reste de votre pipeline (hello, clone, Trivy, NPM, SAFE, Gitleaks, Grype, Checkov, license, etc.) reste inchangé.

### SonarQube (stage sonarqube)

```yaml
sonarqube-scan:
  stage: sonarqube
  image: sonarsource/sonar-scanner-cli:latest
  needs: ["clone-repository"]
  script:
    - echo "SonarQube Scan"
    - sonar-scanner -Dsonar.projectKey="amanibennaceur-group_EnviroTest" -Dsonar.organization="amanibennaceur-group" -Dsonar.sources=user-repo -Dsonar.host.url="https://sonarcloud.io" -Dsonar.token="$SONAR_TOKEN" -Dsonar.exclusions="**/node_modules/**,**/dist/**" || true
  allow_failure: true
```

### OWASP Dependency-Check (stage sca)

```yaml
owasp-dependency-check:
  stage: sca
  image: alpine:latest
  needs: ["clone-repository"]
  before_script:
    - apk add --no-cache openjdk17-jre curl unzip
    - curl -sSLo dependency-check.zip https://github.com/jeremylong/DependencyCheck/releases/download/v10.0.3/dependency-check-10.0.3-release.zip
    - unzip -q dependency-check.zip
  script:
    - echo "OWASP Dependency-Check"
    - mkdir -p reports
    - ./dependency-check/bin/dependency-check.sh --project "$ENVIRONMENT_ID" --format JSON --out reports/owasp --scan user-repo || true
  artifacts:
    paths:
      - reports/owasp/
  allow_failure: true
```

### Report – notification backend (variable BACKEND_URL)

```yaml
notify-results:
  stage: report
  image: alpine:latest
  needs:
    - clone-repository
    - trivy-scan
    - owasp-dependency-check
    - npm-audit
    - safe-analysis
    - gitleaks-secrets
    - grype-scan
    - checkov-scan
    - license-scan
  before_script:
    - apk add --no-cache curl
  script:
    - echo "📧 Envoi des notifications"
    - echo "Pipeline terminé avec tous les scans"
    - |
      curl -X POST "${BACKEND_URL}/projet/api/deploy" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${API_TOKEN}" \
        -d '{
          "status": "completed",
          "environment_id": "'"$ENVIRONMENT_ID"'",
          "pipeline_id": "'"$CI_PIPELINE_ID"'",
          "reports_url": "'"$CI_JOB_URL"'/artifacts"
        }' || echo "⚠️ Notification échouée"
    - echo "✅ Pipeline terminé"
  artifacts:
    paths:
      - reports/
```

**Variables CI/CD à définir dans GitLab :** `BACKEND_URL`, `API_TOKEN`, `SONAR_TOKEN`.

---

## 7. Synthèse

| Critère                     | État actuel              | Après corrections (section 4) |
|-----------------------------|--------------------------|--------------------------------|
| Syntaxe SonarQube / OWASP   | Erreur (multi-lignes)    | Une commande par script       |
| URL backend (report)       | localhost (inutilisable) | BACKEND_URL + API_TOKEN       |
| Types de projets            | Node (Angular), Dockerfile, IaC | Idem ; section 5 pour Python/Go/Java |
| Types de vulnérabilités     | SCA, SAST (Angular), secrets, container, IaC, licences | Idem ; section 5 pour SAST multi-langage |

**Recommandation :** Appliquer d’abord les **corrections de la section 4** (SonarQube, OWASP, BACKEND_URL). Ensuite, selon le besoin « tous projets / toutes vulnérabilités », ajouter la **détection Python/Go/Java** dans clone, **license-checker** pour Node, **pip-audit** pour Python, et **Semgrep** pour SAST multi-langage.

---

*Document aligné sur le pipeline actuel (hello, clone, sonarqube, sca, sast, secrets, container, iac, license, report) – plateforme EnviroTest.*
