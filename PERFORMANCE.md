# PERFORMANCE-Richtlinie

Diese Regeln gelten fuer alle neuen oder refaktorierten Features. Ziel: kein Modul blockiert den Browser durch Voll-Ladevorgaenge, jede Funktion haelt sich an messbare Budgets.

## Grundsaetze

1. **Cursor first**: Listen laden initial maximal 50 Eintraege (oder 200 KB Payload) und verwenden Cursor/Paging fuer alles darueber hinaus.
2. **Kein Full-State**: Globale Stores halten nur sichtbare Ausschnitte, keine kompletten Tabellenkopien.
3. **Arbeiten gegen SQLite**: Alle persistierenden Operationen muessen ueber Worker-APIs mit Limitierung laufen; Snapshots dienen nur Import/Export.
4. **Streaming vor Kopieren**: Fuer Druck, Export und lange Jobs muessen Worker-Streams oder Chunk-Callbacks verwendet werden.
5. **Debounced Persist**: Schreibende Features stellen sicher, dass `persistSqliteDatabaseFile()` nur ueber den bestehenden Debounce getriggert wird.
6. **Fallback-frei**: Neue Funktionen duerfen LocalStorage oder In-Memory-Singletons nicht als Primarspeicher nutzen.
7. **Budget sichtbar machen**: Jeder PR dokumentiert gemessene Heap- und Payload-Werte im QA-Abschnitt, damit die untenstehenden Tabellen nachverfolgbar bleiben.

## Budgettabellen

| Modul            | Initial Load | Max Items im Store | Zus. Anforderungen                    |
| ---------------- | ------------ | ------------------ | ------------------------------------- |
| History UI       | 50 Eintraege | 200 Items          | Cursor + Lazy Detail Fetch            |
| Reporting        | 25 Eintraege | 100 Items          | Filter serverseitig, Druck via Stream |
| Documentation    | 50 Eintraege | 150 Items          | Archive-Logs paginiert                |
| Settings Mediums | 50 Eintraege | 100 Items          | Suche delegiert in Worker             |
| GPS              | 100 Punkte   | 200 Punkte         | Worker-Paging + Bounding Box Filter   |
| Import-Vorschau  | 20 Konflikte | 50 Konflikte       | Chunked ZIP-Analyse                   |
| Lookup           | 25 Treffer   | 75 Treffer         | Sprache optional, Cursor Pflicht      |

> **Messregeln:** Ein Budget gilt als verletzt, sobald `items.length` oder die addierte JSON-Payload (via `structuredClone` + `JSON.stringify`) ueber die Grenzwerte steigt. Jeder Testlauf protokolliert diese Zahlen im Debug-Overlay (siehe unten).

Wer von diesen Grenzwerten abweichen will, dokumentiert das im PR-Template und liefert Messwerte (Heap-Profil, FPS, CPU) mit.

## UX-Muster

- **Vor/Zurueck**: Einheitliche Pager-Leiste mit Vor/Zurueck-Buttons (optional Seiteninfo) anstelle von "Mehr laden"; Buttons bleiben disabled, solange ein Cursor-Call laeuft.
- **Busy-State**: Jede Worker-Anfrage blockiert nur lokale Controls, nicht globale Panels; Ladeindikatoren sollen nach 150 ms erscheinen.
- **Fehlerpfad**: Abbruch einer Paginierung darf keine halbgefuellte Liste im State belassen; Items bleiben unveraendert, es erscheint ein Retry-Hinweis.

## Debug-Hilfen

- **Overlay-Metriken**: Anzeigen je Abschnitt (History, Reporting, Documentation, Settings, GPS, Lookup) von `items.length`, `totalCount`, aktivem Cursor und letzter Fetch-Zeit. Optional zeigt das Panel die geschaetzte Payload-Groesse (`JSON.stringify(items).length / 1024`) und hebt Werte auf Gelb (90 % Budget) bzw. Rot (>100 % Budget).
- **Aktivierungs-Strategie**: Das Overlay wird ausschliesslich ueber das Monitor-Icon neben der Versionsanzeige (`v1` im Footer) geladen. Erst nach einem Klick importiert Bootstrap den Debug-Code und merkt sich den Zustand fuer die laufende Session. Keine Flags oder Query-Parameter mehr – wer messen will, nutzt das Icon.
- **UI-Verhalten**: Das Overlay dockt rechts unten als verschiebbares Panel an, laesst sich per Tastenkombination `Ctrl+Shift+D` ein-/ausblenden und konsumiert keine Pointer-Ereignisse im Content-Bereich, damit Anwender nicht gestoert werden.
- Sobald eine Liste mehr als ihr Budget haelt, loggt `warnIfLargeState(sliceName, size)` eine Warnung mit Stacktrace.
- Feature-Flag `__PSL_DEBUG_FETCHES` aktiviert Timing-Logs pro Worker-Antwort.
- CLI-Hook `npm run perf:report` fasst die letzten Overlay-Messwerte zusammen und scheitert im CI, falls Grenzen ueberschritten wurden.
- In den Worker-Logs muss jede Cursor-Anfrage ihre Parameter (`limit`, `cursor` oder `pageSize`) ausgeben, damit QA die Einhaltung pruefen kann.

## Review-Checkliste

1. Nutzt die Funktion einen existierenden Worker-Endpunkt mit Limitierung?
2. Werden globale Stores nach dem Unmount bereinigt?
3. Sind Pager-UX (Vor/Zurueck) und Busy/Fehler-Faelle abgedeckt?
4. Gibt es QA-Schritte fuer grosse Datensaetze (>=10k History-Eintraege)?
5. Liefern Tests/Notizen Messwerte (Heap <250 MB, Zeit pro Page <250 ms)?

Nur wenn alle Fragen positiv beantwortet wurden, gilt ein Feature als performance-konform.

Siehe auch `task.md` fuer das aktuelle Implementierungsboard der Performance-Regeln.
