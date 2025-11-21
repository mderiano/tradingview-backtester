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
