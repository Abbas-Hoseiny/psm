# Editor Entwicklungsfahrplan

## Vision

Ein professioneller Vorlagen-Editor, der revisionssichere Dokumente mit Live-Vorschau, Auto-Speichern und erweiterter Layoutsteuerung bietet. Ziel ist eine konsistente UX über alle Speicher-Treiber hinweg sowie eine belastbare Synchronisation mit der Datenbank.

## Leitplanken

- **Performance**: Render-Updates <16 ms bei Standard-Layouts (≤50 Felder).
- **Zuverlässigkeit**: Keine Datenverluste trotz Inaktivität oder Treiberwechsel; automatische Sicherungen.
- **Zugänglichkeit**: Tastaturbedienung und ARIA-Feedback.
- **Erweiterbarkeit**: Klar getrennte Layers (Store, View, Persistenz) und Feature-Flags für neue Feldtypen.

## Meilensteine

1. **Stabiler Kern**
   - Auto-Save & Konfliktbehandlung
   - Revisions-Viewer + Wiederherstellung (abgeschlossen)
   - Storage-Treiber Parität (SQLite, FS, LocalStorage)
2. **UX-Optimierung**
   - Inline-Notifications (abgeschlossen)
   - Undo/Redo-Stack aktivieren
   - Kontextmenü vervollständigen (Ausrichtung, Gruppieren, Feld-Duplikate)
3. **Layout & Interaktion**
   - Mehrfeld-Selection mit gemeinsamen Eigenschaften
   - Raster-/Zoom-Einstellungen persistent speichern
   - Ausrichtung & Verteilung von Feldern
   - Drag-and-Drop Platzierung der Felder inkl. Mauszeiger-Schatten
4. **Inhaltliche Erweiterungen**
   - Neue Feldtypen (Datum, Auswahl, Checkbox)
   - Validierungsregeln pro Feldtyp
   - Vorlagenspezifische Metadaten (Tags, Kategorien)
5. **Printing & Preview**
   - Live-Vorschau im Modal (PDF/Print friendly)
   - Export als PDF/HTML
   - Drucklayouts pro Version abspeichern
6. **Collaboration & Audit**
   - Änderungsprotokoll mit Benutzerzuordnung
   - Revision Diff Viewer
   - Export/Import einzelner Vorlagen

## Arbeitsmodus

- Kurze Iterationen (max. 1 Tag) pro Feature
- Jede Änderung mit `npm run build` prüfen
- Aufgaben im `editor-task.md` aktualisieren
- Bugs zuerst beheben, dann Feature-Requests
- UI-Änderungen in Screenshots dokumentieren

## Nächste Schritte

- [x] Auto-Save finalisieren (Fehlerfeedback + visuelles Status-Icon).
- [x] Undo/Redo-Reaktivierung inkl. Snapshot-Sync.
- [x] Mehrfeld-Property-Editor konzipieren & erste Umsetzung.
- [ ] Raster-/Zoom-Einstellungen persistent speichern.
