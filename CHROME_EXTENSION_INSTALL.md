# Installation manuelle de l'extension Chrome

## 📦 Installation en mode développeur

Cette extension n'est pas encore disponible sur le Chrome Web Store. Suivez ces étapes pour l'installer manuellement :

### Étape 1 : Télécharger l'extension

1. Téléchargez le fichier `chrome-extension.zip` depuis la [dernière release](https://github.com/mderiano/tradingview-backtester/releases)
2. Décompressez le fichier ZIP dans un dossier de votre choix
3. **Important** : Conservez ce dossier de manière permanente (ne le supprimez pas après installation)

### Étape 2 : Activer le mode développeur dans Chrome

1. Ouvrez Google Chrome
2. Accédez à la page des extensions :
   - Tapez `chrome://extensions/` dans la barre d'adresse
   - Ou cliquez sur **⋮** (menu) → **Extensions** → **Gérer les extensions**
3. En haut à droite, activez le **Mode développeur** (bouton à bascule)

### Étape 3 : Charger l'extension

1. Cliquez sur le bouton **"Charger l'extension non empaquetée"** (en haut à gauche)
2. Sélectionnez le dossier décompressé contenant l'extension (celui qui contient `manifest.json`)
3. L'extension devrait maintenant apparaître dans la liste

### Étape 4 : Épingler l'extension (optionnel mais recommandé)

1. Cliquez sur l'icône **puzzle** (Extensions) dans la barre d'outils Chrome
2. Trouvez **TradingView Backtest** dans la liste
3. Cliquez sur l'icône **épingle** 📌 pour l'afficher en permanence dans la barre d'outils

## ✅ Vérification de l'installation

- L'extension doit apparaître dans `chrome://extensions/` avec un badge "Non empaqueté"
- L'icône de l'extension doit être visible dans la barre d'outils Chrome

## 🔄 Mise à jour de l'extension

Lorsqu'une nouvelle version est disponible :

1. Téléchargez la nouvelle version depuis les releases
2. Décompressez-la dans le **même dossier** (remplacez les fichiers)
3. Retournez sur `chrome://extensions/`
4. Cliquez sur l'icône **⟳** (Recharger) sur la carte de l'extension

## ⚠️ Notes importantes

- **Ne supprimez pas le dossier de l'extension** après installation, sinon elle cessera de fonctionner
- Le mode développeur doit rester **activé** pour que l'extension fonctionne
- Chrome peut afficher un avertissement au démarrage concernant les extensions en mode développeur (normal)
- L'extension est sûre : le code source complet est disponible dans ce repository

## 🆘 Problèmes courants

### L'extension disparaît après le redémarrage de Chrome
- Vérifiez que le **Mode développeur** est toujours activé
- Vérifiez que le dossier de l'extension n'a pas été déplacé ou supprimé

### "Manifest file is missing or unreadable"
- Assurez-vous de sélectionner le bon dossier (celui qui contient directement `manifest.json`)
- Ne sélectionnez pas le dossier parent

### L'extension ne fonctionne pas sur TradingView
- Rafraîchissez la page TradingView (F5)
- Vérifiez que vous êtes bien connecté à votre compte TradingView
- Ouvrez la console développeur (F12) pour voir les éventuelles erreurs

## 📞 Support

Pour toute question ou problème, ouvrez une [issue sur GitHub](https://github.com/mderiano/tradingview-backtester/issues).
