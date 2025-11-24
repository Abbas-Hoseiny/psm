# PERFORMANCE-Richtlinie

Diese Regeln gelten fuer alle neuen oder refaktorierten Features. Ziel: kein Modul blockiert den Browser durch Voll-Ladevorgaenge, jede Funktion haelt sich an messbare Budgets.

## Grundsaetze

1. **Cursor first**: Listen laden initial maximal 50 Eintraege (oder 200 KB Payload) und verwenden Cursor/Paging fuer alles darueber hinaus.
2. **Kein Full-State**: Globale Stores halten nur sichtbare Ausschnitte, keine kompletten Tabellenkopien.
3. **Arbeiten gegen SQLite**: Alle persistierenden Operationen muessen ueber Worker-APIs mit Limitierung laufen; Snapshots dienen nur Import/Export.
4. **Streaming vor Kopieren**: Fuer Druck, Export und lange Jobs muessen Worker-Streams oder Chunk-Callbacks verwendet werden.
5. **Debounced Persist**: Schreibende Features stellen sicher, dass `persistSqliteDatabaseFile()` nur ueber den bestehenden Debounce getriggert wird.
6. **Fallback-frei**: Neue Funktionen duerfen LocalStorage oder In-Memory-Singletons nicht als Primarspeicher nutzen.

## Budgettabellen

| Modul            | Initial Load | Max Items im Store | Zus. Anforderungen                    |
| ---------------- | ------------ | ------------------ | ------------------------------------- |
| History UI       | 50 Eintraege | 200 Items          | Cursor + Lazy Detail Fetch            |
| Reporting        | 25 Eintraege | 100 Items          | Filter serverseitig, Druck via Stream |
| Documentation    | 50 Eintraege | 150 Items          | Archive-Logs paginiert                |
| Settings Mediums | 50 Eintraege | 100 Items          | Suche delegiert in Worker             |
| GPS              | 100 Punkte   | 200 Punkte         | Worker-Paging + Bounding Box Filter   |
| Import-Vorschau  | 20 Konflikte | 50 Konflikte       | Chunked ZIP-Analyse                   |

Wer von diesen Grenzwerten abweichen will, dokumentiert das im PR-Template und liefert Messwerte (Heap-Profil, FPS, CPU) mit.

## UX-Muster

- **Mehr laden**: Einheitlicher Button plus Auto-Trigger beim Scroll-Ende in Virtual Lists; muss disabled sein, solange ein Cursor-Call laeuft.
- **Busy-State**: Jede Worker-Anfrage blockiert nur lokale Controls, nicht globale Panels; Ladeindikatoren sollen nach 150 ms erscheinen.
- **Fehlerpfad**: Abbruch einer Paginierung darf keine halbgefuellte Liste im State belassen; Items bleiben unveraendert, es erscheint ein Retry-Hinweis.

## Debug-Hilfen

- Dev-Build zeigt ein Overlay mit aktuellen Listen-Groessen, Cursor-Offsets und letzter Fetch-Zeit.
- Sobald eine Liste mehr als ihr Budget haelt, loggt `warnIfLargeState(sliceName, size)` eine Warnung mit Stacktrace.
- Feature-Flag `__PSL_DEBUG_FETCHES` aktiviert Timing-Logs pro Worker-Antwort.

## Review-Checkliste

1. Nutzt die Funktion einen existierenden Worker-Endpunkt mit Limitierung?
2. Werden globale Stores nach dem Unmount bereinigt?
3. Sind "Mehr laden"-UX und Busy/Fehler-Faelle abgedeckt?
4. Gibt es QA-Schritte fuer grosse Datensaetze (>=10k History-Eintraege)?
5. Liefern Tests/Notizen Messwerte (Heap <250 MB, Zeit pro Page <250 ms)?

Nur wenn alle Fragen positiv beantwortet wurden, gilt ein Feature als performance-konform.
