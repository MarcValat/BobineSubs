/** The French UI text, and the shape every other language must match
 * (see Messages): a key missing from a translation doesn't compile. Text
 * that varies with a number or a name is a function. From Bobine Audio:
 * same sections and keys, those this app shows so far (the views not yet
 * redone keep their French text until they are). */
export const fr = {
  common: {
    close: "Fermer",
    retry: "Réessayer",
    help: "Aide",
    httpError: (status: number) => `Erreur ${status}`,
    cancelled: "Annulé",
    log: (n: number) => `Journal (${n})`,
    connectionLost: "Connexion interrompue avant la fin du traitement (le moteur a-t-il planté ?).",
  },

  startup: {
    ready: "Moteur prêt",
    starting: "Démarrage du moteur…",
    unreachable: "Le moteur d'analyse ne répond pas. Réessaie, ou redémarre l'application.",
    unreachableShort: "Le moteur ne répond pas",
  },

  options: {
    title: "Paramètres",
    theme: "Thème",
    themes: { system: "Système", light: "Clair", dark: "Sombre" },
    themeHint: "« Système » suit le thème clair ou sombre de ton système.",
    language: "Langue",
    systemLanguage: "Système",
    languageHint: "« Système » suit la langue de ton système : français s'il est en français, anglais sinon.",
    updates: "Mises à jour",
    checkUpdates: "Vérifier au démarrage",
    updatesHint: "Au lancement, l'application demande à GitHub si une nouvelle version existe ; rien n'est installé sans ton accord.",
  },

  update: {
    downloadingTitle: (percent: number | null) => `Téléchargement de la mise à jour${percent !== null ? ` : ${percent} %` : "…"}`,
    failedTitle: "La mise à jour a échoué",
    availableTitle: (version: string) => `Mise à jour disponible : v${version}`,
    failedHeading: "Échec de la mise à jour",
    availableHeading: (version: string) => `Bobine Subs v${version} est disponible`,
    restartNote: "L'application redémarre une fois la mise à jour téléchargée : une analyse ou un export en cours sera interrompu.",
    install: "Installer et redémarrer",
    downloading: (percent: number | null) => `Téléchargement… ${percent !== null ? `${percent} %` : ""}`,
    installing: "Installation, redémarrage…",
    downloadFailed: (error: string) => `Échec du téléchargement : ${error}`,
    installFailed: (error: string) => `Échec de l'installation : ${error}`,
    restart: "Redémarrer l'application",
  },
};

export type Messages = typeof fr;
