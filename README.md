# TradeIA — version statique   (GitHub Pages)

Application 100 % client : `index.html`, `styles.css`, `app.js`. Aucun serveur, aucune étape de build.

## Tester en local
Ouvre un serveur statique dans le dossier (le double-clic sur index.html marche aussi, mais un serveur évite les soucis de cache) :
```bash
npx serve .        # ou : python3 -m http.server 8000
```

## Déployer sur GitHub Pages
1. Crée un dépôt public sur GitHub (ex. `tradeia`).
2. Dépose les fichiers à la racine : `index.html`, `styles.css`, `app.js`, `.nojekyll`, `README.md`.
3. Va dans **Settings → Pages**.
4. Dans **Build and deployment**, choisis **Source : Deploy from a branch**.
5. Sélectionne la branche **main** et le dossier **/ (root)**, puis **Save**.
6. Attends 1 à 2 minutes : le site est en ligne sur `https://<ton-pseudo>.github.io/tradeia/`.

Chaque `git push` sur `main` redéploie automatiquement.

## Clé API
Clique sur la pastille en haut à droite, colle ta clé `sk-ant-...`, clique sur **Tester** puis **Enregistrer**.
La clé reste dans ton navigateur et n'est envoyée qu'à `api.anthropic.com`.
Pense à fixer une limite de dépense sur console.anthropic.com.
