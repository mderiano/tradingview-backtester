# Politique de confidentialité - TradingView Backtest Extension

**Dernière mise à jour :** 28 novembre 2025

## Introduction

TradingView Backtest Extension ("l'Extension") est une extension Chrome qui permet d'extraire les informations de session et les indicateurs actifs depuis TradingView pour les envoyer vers un serveur de backtesting.

## Données collectées

L'Extension collecte les données suivantes uniquement lorsque vous cliquez sur le bouton "Sync with Backtester" :

### 1. Informations d'authentification TradingView
- **Cookies de session** (`sessionid` et `sessionid_sign`)
- **Objectif** : Permettre au serveur de backtesting d'authentifier les requêtes vers l'API TradingView pour récupérer vos indicateurs privés
- **Stockage** : Temporairement dans chrome.storage.local, puis transmis au serveur de backtesting

### 2. Configuration du graphique TradingView
- **Indicateurs/stratégies actifs** avec leurs paramètres
- **Symbole** de trading (ex: BTCUSDT)
- **Période** (timeframe, ex: 1h, 4h, 1D)
- **Objectif** : Permettre au serveur de backtesting de reproduire votre configuration pour effectuer les tests
- **Stockage** : Temporairement dans chrome.storage.local, puis transmis au serveur de backtesting

## Utilisation des données

Les données collectées sont utilisées **uniquement** pour :
- Authentifier les requêtes vers l'API TradingView
- Récupérer les configurations d'indicateurs/stratégies
- Exécuter des backtests avec vos paramètres

## Partage des données

**Nous ne vendons, ne louons ni ne partageons vos données avec des tiers.**

Les données sont transmises uniquement vers :
- Le serveur de backtesting hébergé à `http://srv1159534.hstgr.cloud:3000`
- L'API TradingView (via votre session authentifiée)

## Conservation des données

- **Dans l'extension** : Les données sont conservées dans chrome.storage.local jusqu'à ce que vous les supprimiez manuellement ou désinstalliez l'extension
- **Sur le serveur** : Les résultats de backtests sont conservés pendant 15 jours par défaut, puis automatiquement supprimés

## Sécurité

- Toutes les communications avec le serveur de backtesting utilisent HTTPS lorsque possible
- Les cookies de session sont transmis de manière sécurisée
- Aucun code distant n'est exécuté (tout le code est inclus dans l'extension)

## Vos droits

Vous pouvez :
- **Supprimer vos données** : Désinstallez l'extension ou videz chrome.storage.local
- **Ne pas partager vos données** : N'utilisez pas l'extension

## Modifications de cette politique

Nous pouvons mettre à jour cette politique de confidentialité occasionnellement. La date de "Dernière mise à jour" sera modifiée en conséquence.

## Contact

Pour toute question concernant cette politique de confidentialité, veuillez ouvrir une issue sur le dépôt GitHub :
https://github.com/mderiano/tradingview-backtester/issues

## Conformité

Cette extension respecte :
- Le Règlement du programme Chrome Web Store pour les développeurs
- Les bonnes pratiques de protection de la vie privée
- L'utilisation minimale des permissions nécessaires à son fonctionnement
