# TODO-Plan

- [ ] Startup-Wizard für neue Datenbank: Formular für Firmenname, Überschrift, Logo-URL und weitere Stammdaten; JSON anhand der Eingaben erzeugen.
- [ ] Download-Option im Startup-Screen: JSON/ZIP-Download der so erzeugten Datenbank (inkl. File-System-Variante) für neue Nutzer ohne bestehende DB.
- [ ] Validierungslogik für JSON-Datenbanken anhand von `assets/config/schema.json` implementieren (Import/Export prüfen, Fehler anzeigen).
- [ ] Speicherung von History-Einträgen über Storage-Adapter sicherstellen (Schreibstatus und Fehlerkommunikation anzeigen).
- [ ] Benachrichtigungssystem (Toast/Alert) für Erfolg- und Fehlermeldungen einführen.
- [ ] `settings`-Feature um UI zur Bearbeitung von Berechnungsmethoden erweitern (CRUD, Eingabefelder je Methode, Typauswahl).
- [ ] Dynamische Eingabefelder im Berechnungsformular rendern, abhängig von den in den Methoden geforderten `requires`-Feldern.
- [ ] Export-/Import-Workflow für JSON-Dateien anbieten (Download-Button, Drag&Drop-Upload als Alternative zum File-Picker).
- [ ] Druck-/PDF-Layouts überarbeiten und Firmenbranding dynamisch ziehen.
- [ ] Reporting-Ansicht um Aggregationen (Summen/Diagramme) erweitern.
- [ ] Komponententests für Formeln und State-Reducer (z. B. Vitest) hinzufügen.
- [ ] Automatisierte UI-Checks mit Playwright für Kernflows.
- [ ] Mehrsprachigkeit über `assets/js/core/i18n.js` vorbereiten (Deutsch/Englisch).
- [ ] Mehrbenutzer-Szenario prüfen (z. B. Synchronisation über Remote-Storage oder Datei-Share).
- [ ] Progressive-Web-App-Funktionalität untersuchen (Service Worker, Offline-Cache).
- [ ] Barrierefreiheit (WCAG) auditieren und verbessern (Kontraste, Tastaturnavigation, ARIA-Labels).
