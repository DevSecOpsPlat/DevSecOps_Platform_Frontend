# Proposition détaillée des interfaces EnviroTest

Document de spécification UX/UI inspiré Vercel, avec la palette et l’identité EnviroTest.

---

## 1. Navbar (épurée et contextuelle)

### Concept : "Espaces de travail"

**Partie gauche**
- Logos (Attijari + EnviroTest)
- Nom « EnviroTest »
- Séparateur vertical (`|`)
- **Menu déroulant** pour choisir l’application (contexte actuel)

**Partie droite**
- **Bouton « + New Deployment »** : noir ou bleu électrique, bien mis en avant
- **Icône cloche** : notifications (à brancher sur le backend / webhook)
- **Avatar utilisateur** : menu profil, déconnexion

**Comportement**
- Après authentification : redirection vers la page **Home** (dashboard principal)

---

## 2. Modal de succès post-déploiement (Glassmorphism)

### Remplacement des alertes Windows classiques

**Design**
- Modal avec **flou d’arrière-plan** (glassmorphism)
- **Icône de check verte animée**
- Texte : `Deployment Initiated Successfully!`

**Actions**
| Bouton | Style | Comportement |
|--------|-------|--------------|
| **Track Progress** | Plein (primary) | Ouvre le sidebar / vue projet |
| **Open GitLab** | Outline + icône GitLab | Ouvre l’URL GitLab dans un nouvel onglet |

---

## 3. Sidebar animé (expérience type Vercel)

### Comportement
- Ouverture au clic sur « Track Progress » (ou depuis la navbar)
- **Animation** : glissement depuis la gauche ou la droite
- **Marge** : prévoir un espace sous la navbar pour éviter le chevauchement avec l’app-bar

### Onglets du sidebar

#### A. Overview — « Pulse » du projet

| Élément | Description |
|---------|-------------|
| **Statut** | Badge avec animation (Running = bleu pulsant, Ready = vert) |
| **URL environnement** | Lien cliquable vers l’URL de déploiement (ex. `myapp-stage-1.azure.io`) |
| **Timer TTL** | Barre de progression circulaire pour le temps restant avant suppression |

#### B. Deployments — Timeline

Liste verticale des versions, chaque ligne affiche :
- **Message de commit** (ex. "Fix login bug")
- **SHA** (ex. `a1b2c3d`)
- **Branche**

#### C. Logs — Aspect « Dev »

- Zone de logs en **fond noir** avec typo monospace (ex. Fira Code)
- Bouton **« Follow »** : scroll automatique vers le bas à mesure que GitLab envoie des logs

#### D. Security Insights — Aspect « Sec » (DevSecOps)

Mise en avant des cartes plutôt que du texte brut.

**Grille de 3 cartes**
| Carte | Contenu |
|-------|---------|
| **Vulnerabilities** | Gros chiffre avec code couleur (ex. 12) |
| **SAST Score** | Note A–F (SonarQube) |
| **Policy Status** | `Passed` ou `Failed` |

**Donut chart** : répartition des vulnérabilités (Critical / High / Medium)

---

## 4. Détails des stages — Workflow (Steppers)

### Position
Sous l’Overview ou les Logs.

### Design
- Ligne horizontale de **steppers**
- Ordre : `Clone → Build → Security Scan → Deploy`

### Icônes par état

| État | Icône |
|------|-------|
| En attente | Sablier |
| En cours | Cercle / spinner |
| Succès | Check vert |
| Échec | Croix rouge (cliquable pour l’erreur détaillée) |

---

## 5. Conseils de pro (CSS/UI)

### Animations
- **Angular** : `@angular/animations` pour l’ouverture/fermeture du sidebar
- Transitions fluides (~300 ms)

### Dark mode
- Fond : `#0f172a`
- Cartes : `#1e293b`
- Texte : contrastes adaptés pour lisibilité

### Skeleton screens
- Pendant le polling / chargement vers GitLab
- Formes grises avec léger clignotement à la place du spinner

### Touche finale type Vercel
- Bouton **« Share Preview URL »** : copie l’URL de preview (Azure) dans le presse-papier
- Indication courte « Copied! » après le clic

---

## 6. Restrictions / Points à ne pas faire

- Ne pas afficher « Créé par » : l’utilisateur ne voit que ce qu’il crée
- Conserver les éléments déjà implémentés ; ce document complète et affine les choix

---

## 7. Structure des routes (rappel)

```
/                    → Redirect Home
/home                → Dashboard
/project/:appId/overview
/project/:appId/deployments
/project/:appId/logs
/project/:appId/security
/pipeline/:envId     → Détail pipeline (stages, logs, etc.)
```

---

## 8. Priorisation suggérée

1. Navbar (menu app + bouton New Deployment + cloche + avatar)
2. Modal de succès post-déploiement (glassmorphism)
3. Sidebar animé avec marge sous la navbar
4. Overview (badge pulsant, URL, TTL circulaire)
5. Steppers (Clone → Build → Scan → Deploy)
6. Security Insights (3 cartes + donut)
7. Logs (zone noire, bouton Follow)
8. Skeleton screens + Dark mode + Share Preview URL
