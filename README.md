# TradingView Strategy Backtester

Système automatisé pour tester des stratégies Pine Script et récupérer les résultats de backtest.

## 📦 Prérequis

Avant d'installer ce projet, assurez-vous d'avoir Node.js et npm installés.

### Installation de Node.js et npm

**Sur Ubuntu/Debian:**
```bash
# Installer Node.js 20.x (version LTS recommandée)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Vérifier l'installation
node --version  # Devrait afficher v20.x.x
npm --version   # Devrait afficher 10.x.x
```

**Sur macOS:**
```bash
# Avec Homebrew
brew install node

# Vérifier l'installation
node --version
npm --version
```

**Sur Windows:**
- Télécharger l'installeur depuis [nodejs.org](https://nodejs.org/)
- Exécuter l'installeur et suivre les instructions
- Redémarrer le terminal après installation
- Vérifier avec `node --version` et `npm --version`

## 🚀 Installation

```bash
npm install
```

## ⚙️ Configuration (Optionnelle)

Le serveur fonctionne avec les valeurs par défaut. La configuration n'est nécessaire que si vous souhaitez personnaliser:

**Variables disponibles:**
- `PORT` - Port du serveur (défaut: 3000)
- `RETENTION_DAYS` - Durée de conservation des résultats en jours (défaut: 15)
- `BACKTEST_TIMEOUT_MS` - Timeout des backtests en millisecondes (défaut: 120000)

**Pour personnaliser:**
1. Copiez le fichier d'exemple: `cp .env.example .env`
2. Éditez `.env` et décommentez/modifiez les valeurs souhaitées

**Note:** Les credentials TradingView (session/signature) sont maintenant fournis directement via l'extension Chrome et ne sont plus stockés dans le fichier .env.

## 🚀 Lancer le serveur

```bash
npm start
```

Le serveur démarrera sur `http://localhost:3000`

### 🔄 Exécution en arrière-plan avec PM2 (Production)

Pour faire tourner le serveur en permanence, même après avoir fermé votre connexion SSH, utilisez PM2 :

**Installation de PM2 :**
```bash
npm install -g pm2
```

**Démarrer le serveur avec PM2 :**
```bash
pm2 start server.js --name "tv-backtester"
```

**Commandes utiles PM2 :**
```bash
pm2 list                    # Voir les processus en cours
pm2 logs tv-backtester      # Voir les logs en temps réel
pm2 monit                   # Monitorer les performances
pm2 restart tv-backtester   # Redémarrer l'application
pm2 stop tv-backtester      # Arrêter l'application
pm2 delete tv-backtester    # Supprimer de PM2
```

**Auto-démarrage au reboot du serveur :**
```bash
pm2 startup                 # Générer le script de démarrage
pm2 save                    # Sauvegarder la liste des processus
```

## 📊 Utilisation

**Important:** Ce système nécessite l'extension Chrome pour fonctionner. L'extension fournit automatiquement les credentials TradingView nécessaires.

### Installation de l'extension Chrome

1. **Installez l'extension** :
   - Ouvrez Chrome et accédez à `chrome://extensions/`
   - Activez le "Mode développeur" (coin supérieur droit)
   - Cliquez sur "Charger l'extension non empaquetée"
   - Sélectionnez le dossier de l'extension (fichier `chrome-extension.zip` à décompresser)

2. **Connectez-vous à TradingView** :
   - Ouvrez [TradingView](https://www.tradingview.com) dans Chrome
   - Connectez-vous à votre compte TradingView
   - L'extension détectera automatiquement vos credentials

### Utilisation du backtester

1. **Lancez le serveur** (si ce n'est pas déjà fait) :
   ```bash
   npm start
   ```

2. **Ouvrez l'interface** via l'extension Chrome :
   - Cliquez sur l'icône de l'extension dans Chrome
   - Ou accédez directement à `http://localhost:3000` (ou le port configuré)

3. **Sélectionnez un indicateur** :
   - Entrez l'ID de l'indicateur (public ou privé)
   - Cliquez sur "Fetch Options" pour charger les paramètres

4. **Configurez votre backtest** :
   - **Symboles** : Ajoutez les symboles à tester (ex: BINANCE:BTCUSDT, NASDAQ:AAPL)
   - **Timeframes** : Sélectionnez les périodes (1m, 5m, 15m, 4h, 1D, 1W, etc.)
   - **Options** : Configurez les paramètres de l'indicateur
   - **Ranges** : Définissez des plages pour tester plusieurs valeurs d'un paramètre

5. **Exécutez le backtest** :
   - Cliquez sur "Run Backtest"
   - Suivez la progression en temps réel
   - Les résultats s'afficheront au fur et à mesure

6. **Analysez les résultats** :
   - Cliquez sur une ligne du tableau pour voir les analytics détaillées
   - Consultez la courbe d'équité, les métriques de performance et la liste des trades
   - Exportez les résultats en Excel si nécessaire

## ✨ Fonctionnalités

- **Test multi-symboles et multi-timeframes** : Testez plusieurs configurations en une seule fois
- **Optimisation par plages** : Testez automatiquement différentes valeurs de paramètres
- **Suivi en temps réel** : Progression live via WebSocket
- **Analytics détaillées** : Métriques complètes, graphiques d'équité, liste des trades
- **Export Excel** : Exportez vos résultats pour analyse approfondie
- **Sauvegarde automatique** : Vos paramètres sont sauvegardés dans le navigateur
