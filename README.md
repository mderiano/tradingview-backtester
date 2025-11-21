# TradingView Strategy Backtester

Système automatisé pour tester des stratégies Pine Script et récupérer les résultats de backtest.

## 🚀 Installation

```bash
npm install
```

## 🔑 Configuration

1. Connectez-vous à TradingView dans votre navigateur
2. Ouvrez les Developer Tools (F12)
3. Allez dans **Application** > **Cookies** > **https://www.tradingview.com**
4. Copiez les valeurs de `sessionid` et `signature`
5. Créez un fichier `.env` :

```bash
cp .env.example .env
```

6. Éditez `.env` et collez vos credentials :

```
SESSION=votre_sessionid
SIGNATURE=votre_signature
```

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

1. **Ouvrez votre navigateur** et accédez à `http://localhost:3000`

2. **Sélectionnez un indicateur** :
   - Entrez l'ID de l'indicateur (public ou privé)
   - Cliquez sur "Fetch Options" pour charger les paramètres

3. **Configurez votre backtest** :
   - **Symboles** : Ajoutez les symboles à tester (ex: BINANCE:BTCUSDT, NASDAQ:AAPL)
   - **Timeframes** : Sélectionnez les périodes (1m, 5m, 15m, 4h, 1D, 1W, etc.)
   - **Options** : Configurez les paramètres de l'indicateur
   - **Ranges** : Définissez des plages pour tester plusieurs valeurs d'un paramètre

4. **Exécutez le backtest** :
   - Cliquez sur "Run Backtest"
   - Suivez la progression en temps réel
   - Les résultats s'afficheront au fur et à mesure

5. **Analysez les résultats** :
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
