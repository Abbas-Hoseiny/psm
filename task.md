# Projektziel

Ein webbasiertes System bereitstellen, mit dem Betriebe ihre Pflanzenschutz-Anwendungen ab 2026 digital erfassen, lokal archivieren (mindestens 3 Jahre) und bei Behördenanfragen als maschinenlesbare Exporte (JSON/CSV, optional ZIP) zusammenstellen sowie zeitlich filtern können. Die Nutzer:innen konfigurieren dazu individuelle Vorlagen im A4-Leitlayout für ihr Formular (Drag & Drop), erfassen Anwendungen auf Basis dieser Vorlagen, verwalten lokale Backups/Backlog-Dateien und können Daten aus mehreren Dateien zusammenführen und für beliebige Zeitfenster exportieren.

## Bereichs- und UI-Spezifikation

### Vorlage-Designer (Seitenname: "Vorlage")

- **Layout**: Dreispaltig – linke Sidebar (240 px) mit Bausteinkatalog, zentrales A4-Arbeitsfeld (fester Maßstab, Raster 12 × 16), rechte Sidebar (280 px) für Eigenschaften der selektierten Komponente.
- **Bausteine** (Drag & Drop, auch per Klick hinzufügbar):
  - `Label` (reine Beschriftung, Schriftgröße/Style per Properties wählbar)
  - `Zahl` (Input Typ number, Parameter: Placeholder, Einheit, Min/Max, Step, Pflichtfeld)
  - `Text` (einzeilig oder mehrzeilig, optional Zeichenlimit, Pflichtfeld)
  - Platzhalter für zukünftige Felder (z. B. Datum, Checkbox) als deaktivierte Elemente anzeigen.
- **Properties-Panel** (rechte Sidebar): Kontextsensitiv – Feldname, technische ID (read-only, automatisch generiert), Label, Placeholder, Pflichtstatus, Validierung, Feldweite (Spaltenbreite in Rastereinheiten), Höhe, Ausrichtung.
- **Toolbar** (oberhalb des Arbeitsfeldes): Buttons für `Neu`, `Speichern`, `Speichern unter`, `Duplizieren`, `Vorschau`, `Undo`, `Redo`, `Raster ein/aus`, `Snap an/aus`.
- **Interaktionen**: Drag, Resize (an Raster ausgerichtet), Mehrfachauswahl mit Shift/Marquee, Kontextmenü (Delete, Duplizieren, Nach vorne/hinten).
- **Vorlagenliste**: In der linken Sidebar oberhalb der Bausteine ein Dropdown mit vorhandenen Vorlagen (Suchfeld, Favoritenstern, Sortierung nach Name/Datum), Neu/Umbenennen/Löschen via Icon-Buttons.
- **Speicherformat**: Template JSON enthält Meta (id, version, name, description), Layout (Grid-Units, Position, Size, Layer), Field-Definition (type, label, validations, default, printStyles).

### Erfassung/Berechnung (Seitenname: "Berechnung")

- **Layout**: Zweispaltig – linke Sidebar (280 px) mit Vorlagenauswahl, Datumsfilter, Schnellsuche; rechter Hauptbereich für dynamisches Formular + Ergebnis/History.
- **Vorlagenauswahl**: Kachel- oder Listenansicht mit Vorschaubild (Miniatur der A4-Vorlage), Meta (Name, letzte Änderung, Felder). Buttons: `Verwenden`, `Vorschau`, `Editieren` (öffnet Vorlage-Designer mit Kontext), `Duplizieren`.
- **Formular-Rendering**: Felder in responsivem Layout (z. B. CSS Grid, zwei Spalten auf Desktop). Pflichtfelder klar markiert (`*` + roter Rand bei Fehler), Inline-Validierung, Summen/Auto-Berechnungen aus Template-Felddefinition.
- **Ergebniskarte**: Nach Absenden, separate Tabs `Zusammenfassung`, `Detailtabelle`, `Historie`. Zusammenfassung übernimmt Layoutstruktur zur Anzeige (A4-Preview). Detailtabelle zeigt aus Template markierte Felder für Tabellenform.
- **Aktionen**: `Speichern & archivieren`, `Nur lokal speichern`, `Drucken/PDF`, `Neuer Eintrag`, `Bearbeiten`, `Duplizieren`. Statusanzeige für Auto-Backup (Icon + Tooltip mit Speicherpfad/Driver).
- **History integriert**: Unter Formular eine Zeitleiste oder Tabelle der letzten Einträge (Filter: Zeitraum, Template, Nutzer). Inline-Buttons `Ansehen`, `PDF`, `Export JSON`, `Löschen`.

### Merge/Export (Seitenname: "Merge/Export")

- **Layout**: Drei Abschnitte untereinander mit Tabs `Backups`, `Merge`, `Export` (Tabs persistent).
- **Backups**: Liste aller lokalen Sicherungen (Quelle, Datum, Größe, Hash). Buttons `Neues Backup (JSON/ZIP)`, `Importieren`, `Löschen`. Import validiert Schema/Version und zeigt Vorschau.
- **Merge**: Zweispaltiges Interface – links Auswahlliste der verfügbaren Dateien/Backups (mit Checkboxen, Zeitraum, Template-Anzahl), rechts Merge-Konfiguration (Zielzeitraum, Konfliktregeln (Priorität, Duplikatstrategie), Vorschau der resultierenden Datensätze). Abschluss mit `Merge simulieren`, `Merge anwenden`.
- **Export**: Filterleiste (Zeitraum, Templates, Felder, optional BVL-IDs). Ausgabeformate: `JSON`, `CSV`, `ZIP (JSON+CSV)`, optional `PDF`. Fortschrittsbalken, Ergebnis-Verzeichnis frei wählbar (Fallback Download). Log-Fenster mit detaillierter Zusammenfassung (Einträge gezählt, Duplikate, Warnungen).
- **Sicherheit**: Prüfsumme (SHA-256) pro Exportdatei anzeigen, optional Signatur-Hook vorsehen. Log/Protokoll in SQLite (Audit Trail) festhalten.

### Global

- Dunkles Theme wie bestandene App, anpassbar über Settings.
- Navigationseinträge: `Dashboard (optional)`, `Berechnung`, `Vorlage`, `Merge/Export`, `Einstellungen`, `BVL-Daten`, `Historie` (falls separat benötigt).
- Toast/Notifications für Speichern, Fehler, Validierungswarnungen.
- i18n-fähige Labels (DE initial, Struktur offen für EN).

## Schrittübersicht (priorisiert)

### Recherche & Planung (Stand 12.11.2025)

- [x] Markt- und UX-Analyse zu professionellen Formular-/Template-Editoren (Typeform, Zoho, MDN, web.dev, UXPin).
- [x] Ableitung von UX-/Funktionszielen: Multi-Pane-Layout, Inline-Validierung, Undo/Redo, Vorschau, Versionshistorie, Kollaborations-Hooks.
- [x] Grobkonzept für technische Umsetzung: State-Machine + Command-Stack, schema-getriebene Field-Registry, responsive Layout-Engine, Analytics-Hooks.
- [ ] Feature-Priorisierung mit Stakeholder:innen abstimmen (Must-haves vs. Phase-2-Features).
- [ ] Low-Fidelity-Wireframes/User-Flows für neuen Editor (Panen, Toolbar, Historie, Vorschau) skizzieren.
- [ ] Technische Spike-Planung für neue Kernmodule (Undo/Redo-Command-Stack, Validation-Service, Layout-Engine Refactor).

### 1. Datenmodell & Persistenz vorbereiten

- [x] Bestehendes Schema analysieren (Templates, History, BVL getrennt halten) und Datenhaltungsanforderungen (3 Jahre, maschinenlesbar) dokumentieren.
- [x] Neues Template-Datenmodell definieren (Feldtypen, Layoutmetadaten, Versionierung) und Migration für bestehende Nutzer:innen entwerfen.
- [x] SQLite-Schema erweitern (z. B. Tabelle `templates`, Anpassung `history` für flexible Felder) und JSON-Snapshot-Format entsprechend aktualisieren.
- [x] Persistenz-API im Frontend anpassen (Laden/Speichern von Templates, History-Einträgen getrennt von BVL-Daten).

### 2. Vorlagen-Editor ("Vorlage"-Bereich)

- [x] UI-Rahmen bauen: A4-Leitfläche mit fixem Header (Firmeninfos) und Sidebar für Bausteine.
- [x] Drag-&-Drop/Resize-Layer implementieren (z. B. Grid-basiert) für Komponentenplatzierung auf der A4-Fläche.
- [x] Bausteinkatalog umsetzen (Label, Zahl, Text; später erweiterbar) inkl. Property-Editor für Bezeichnungen, Placeholder, Pflichtstatus, Validierungen.
- [ ] Vorlagen-Speicherung (create/update/delete, Versionierung, Änderungsverlauf) gegen SQLite-Schema verdrahten.
  - [x] Speichern fragt optional Änderungszusammenfassung ab und zeigt Versions-/Historienmetadaten im Editor.
  - [ ] Revisionsliste (UI + Revert) und direkte SQLite-Speicherpfade finalisieren.
- [ ] UX-Details laut Spezifikation (Undo/Redo, Kopieren, Raster/Snap, Vorschau, Mehrfachauswahl, Kontextmenü) priorisieren und umsetzen.

### 3. Berechnungs-/Erfassungsbereich auf Vorlagen umstellen

- [ ] Sidebar für Vorlagenauswahl inkl. Kachel-/Listenansicht, Suche, Favoriten und Aktionen integrieren.
- [ ] Formular-Rendering dynamisch aus Template-Definition generieren (Responsives Layout fürs Eingeben, Positionsdaten fürs Rendering/Print nutzen).
- [ ] Validierung und Pflichtfeld-Handling pro Feldtyp implementieren (numerische Grenzen, Textlängen, etc.).
- [ ] Ergebnisdarstellung (Zusammenfassung/A4-Preview, Detailtabellen, Historie) mit Template-Daten verknüpfen; bisherige festen Felder ablösen.
- [ ] Speicherroutine aktualisieren (History-Eintrag mit Template-ID + Feldwerte) und automatisches Backup testen.

### 4. Druck & visuelle Ausgabe

- [ ] A4-Print/PDF-Renderer so umbauen, dass er Template-Layout (Position, Größe, Reihenfolge) nutzt.
- [ ] Firmenkopf/Meta-Daten korrekt platzieren; Template-Felder inklusive Formatierung auf dem Ausdruck anzeigen.
- [ ] Druck-/PDF-Flow testen (Browser-Print, ggf. PDF.js/Print-Service) und sicherstellen, dass Werte vollständig und korrekt erscheinen.

### 5. Merge/Export-Bereich

- [ ] UI-Bereich "Merge/Export" gemäß Tab-Spezifikation (Backups, Merge, Export) aufbauen.
- [ ] Backup-Writer für JSON/ZIP bereitstellen (komplette SQLite-Snapshot-Daten, optional differenziell) und Prüfsumme erzeugen.
- [ ] Merge-Engine implementieren: mehrere Backups einlesen, Konfliktregeln anwenden, Simulation & Ergebnisprüfung anbieten.
- [ ] Export-Pipeline für beliebige Zeiträume (JSON, CSV, ZIP, optional PDF) mit Filterung, Fortschritt und Ablagepfad bauen.
- [ ] Sicherheit/Integrität: Prüfsummen, Versionsmetadaten, Audit-Log, optional Signatur-Hooks planen und umsetzen.

### 6. BVL-Daten und Pflanzenschutz-Anwendungen trennen

- [ ] Aktuelles Datenmodell prüfen, um sicherzustellen, dass BVL-Stammdaten und individuelle Anwendungen entkoppelt gespeichert werden.
- [ ] APIs/Module entsprechend anpassen (z. B. getrennte Stores oder Namensräume) und Tests aktualisieren.

### 7. Tests, Migration & Dokumentation

- [ ] Migrationstests (alte Daten → neues Schema) und Rückwärtskompatibilität prüfen.
- [ ] Unit-/Integrationstests für Template-Editor, Formular-Rendering, Merge/Export-Pipelines erstellen.
- [ ] Nutzer-Dokumentation aktualisieren (Vorlagen erstellen, Felder konfigurieren, Exporte/Merge nutzen, Datensicherung).
- [ ] Release-Plan & Kommunikationsplan definieren (ggf. Beta-Phase, Import-Anleitungen).
