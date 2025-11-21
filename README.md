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

## 📊 Utilisation

```bash
npm test
```

Le script va :
1. Se connecter à TradingView avec vos credentials
2. Charger la stratégie EMA Cross + RSI
3. Exécuter le backtest
4. Afficher les résultats (Net Profit, % Profitable, Max Drawdown, etc.)

## 🔧 Personnalisation

Éditez `test-strategy.js` pour :
- Changer de symbole (BTCUSDT, ETHUSDT, etc.)
- Modifier le timeframe (1m, 5m, 1h, D, W)
- Tester une autre stratégie (changez `strategyCode`)

## 📈 Exemple de sortie

```
🚀 Starting TradingView Strategy Backtester...

📊 Chart: BINANCE:BTCUSDT (D)

📝 Creating strategy indicator...
✅ Strategy loaded successfully!

📈 Strategy Report:

Net Profit: 1234.56
Total Closed Trades: 42
Percent Profitable: 65.00%
Profit Factor: 1.85
Max Drawdown: -234.00 (-5.67%)

✅ Backtest complete!
```

## 🎯 Prochaines étapes

- Ajouter un optimizer de paramètres (tester automatiquement différentes valeurs d'EMA)
- Créer un système de comparaison de stratégies
- Générer des rapports visuels avec des graphiques
