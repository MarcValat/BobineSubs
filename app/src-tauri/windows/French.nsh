; Tauri's own French installer texts (tauri-cli 2.12.1, unchanged since 2.11.5, crates/tauri-bundler/.../nsis/languages/French.nsh),
; in place of them through bundle.windows.nsis.customLanguageFiles (tauri.conf.json).
; Changed: the reinstall page's texts, shortened -- its label is 3 lines high
; (24u) and the longest was cut off mid-sentence; French typos fixed.
; Check them against a newer tauri-cli's file when upgrading it.

LangString addOrReinstall ${LANG_FRENCH} "Ajouter/Réinstaller un composant."
LangString alreadyInstalled ${LANG_FRENCH} "Déjà installé."
LangString alreadyInstalledLong ${LANG_FRENCH} "${PRODUCTNAME} ${VERSION} est déjà installé. Choisissez une opération, puis cliquez sur Suivant."
LangString appRunning ${LANG_FRENCH} "{{product_name}} est en cours d'exécution. Veuillez fermer l'application avant de réessayer."
LangString appRunningOkKill ${LANG_FRENCH} "{{product_name}} est en cours d'exécution.$\nCliquez sur OK pour fermer l'application."
LangString chooseMaintenanceOption ${LANG_FRENCH} "Veuillez choisir l'option de maintenance à effectuer."
LangString choowHowToInstall ${LANG_FRENCH} "Veuillez choisir l'emplacement d'installation de ${PRODUCTNAME}."
LangString createDesktop ${LANG_FRENCH} "Créer un raccourci sur le bureau."
LangString dontUninstall ${LANG_FRENCH} "Ne pas désinstaller"
LangString dontUninstallDowngrade ${LANG_FRENCH} "Ne pas désinstaller (revenir à une ancienne version sans désinstallation est désactivé pour cet installateur)"
LangString failedToKillApp ${LANG_FRENCH} "La fermeture de {{product_name}} a échoué. Veuillez fermer l'application et réessayer."
LangString installingWebview2 ${LANG_FRENCH} "Installation de WebView2..."
LangString newerVersionInstalled ${LANG_FRENCH} "Une version plus récente de ${PRODUCTNAME} est déjà installée. Il est déconseillé d'installer une version plus ancienne, sauf après avoir désinstallé l'actuelle. Choisissez une opération, puis cliquez sur Suivant."
LangString older ${LANG_FRENCH} "plus ancienne"
LangString olderOrUnknownVersionInstalled ${LANG_FRENCH} "Une version $R4 de ${PRODUCTNAME} est installée. Il est recommandé de la désinstaller avant d'installer celle-ci. Choisissez une opération, puis cliquez sur Suivant."
LangString silentDowngrades ${LANG_FRENCH} "Revenir à une version antérieure est désactivé pour cet installateur. Impossible de continuer avec l'installation silencieuse, veuillez utiliser l'interface graphique à la place.$\n"
LangString unableToUninstall ${LANG_FRENCH} "Impossible de désinstaller le programme !"
LangString uninstallApp ${LANG_FRENCH} "Désinstaller ${PRODUCTNAME}"
LangString uninstallBeforeInstalling ${LANG_FRENCH} "Désinstaller avant d'installer"
LangString unknown ${LANG_FRENCH} "inconnue"
LangString webview2AbortError ${LANG_FRENCH} "L'installation de WebView2 a échoué ! L'application ne peut s'exécuter sans WebView2. Veuillez essayer de redémarrer l'installation."
LangString webview2DownloadError ${LANG_FRENCH} "Erreur : le téléchargement de WebView2 a échoué - $0"
LangString webview2DownloadSuccess ${LANG_FRENCH} "Le composant WebView2 a été téléchargé avec succès !"
LangString webview2Downloading ${LANG_FRENCH} "Téléchargement du composant WebView2..."
LangString webview2InstallError ${LANG_FRENCH} "Erreur : l'installation de WebView2 a échoué avec le code d'erreur $1"
LangString webview2InstallSuccess ${LANG_FRENCH} "L'installation de WebView2 a réussi"
LangString deleteAppData ${LANG_FRENCH} "Supprimer les données de l'application"
