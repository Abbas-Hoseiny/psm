# Pflanzenschutz-Aufzeichnung

Eine einfache, kostenlose Web-App für Gärtner:innen, Höfe und Betriebe, die ihre Pflanzenschutzmaßnahmen sauber dokumentieren möchten. Die Anwendung läuft komplett im Browser – ohne Registrierung, ohne Cloud-Zwang.

## Warum ihr uns vertrauen könnt

- **Alles bleibt lokal:** Berechnungen, Historie und Stammdaten werden nur auf deinem Gerät gespeichert. Du entscheidest selbst, ob du eine Datei exportierst.
- **Offline nutzbar:** Nach dem ersten Laden funktioniert die App auch ohne Internetverbindung weiter.
- **Open Source:** Der gesamte Code liegt hier auf GitHub. Jede Änderung ist nachvollziehbar.
- **Keine versteckten Kosten:** Das Tool ist dauerhaft kostenlos und darf frei genutzt werden (MIT-Lizenz).

## So startest du in 2 Minuten

1. Öffne **https://abbas-hoseiny.github.io/pestalozzi/** in Chrome, Edge oder Firefox.
2. Klicke auf **„Defaults testen“**, um mit Beispieldaten zu spielen. Dafür ist keine Datei und kein Login nötig.
3. Gefällt dir der Ablauf? Dann kannst du später eine eigene Datenbank erstellen oder eine vorhandene JSON/SQLite-Datei verbinden.

## Wichtige Sicherheits-Vorteile

- Deine Daten verlassen den Browser nur, wenn du sie selbst exportierst oder teilst.
- Beim Schließen der Seite erhältst du einen Hinweis, falls eine Datenbank noch geöffnet ist.
- Optionaler SQLite-Modus speichert die Daten als Datei auf deinem Rechner – perfekt für Backups.

## Tipps zur Datensicherung

- Exportiere von Zeit zu Zeit eine Datei (`.sqlite` oder `.json`).
- Lege Backups an einem sicheren Ort ab (USB-Stick, NAS, Nextcloud).
- Wenn du nur schauen willst, reicht der Default-Modus: alle Daten können jederzeit gelöscht werden.

## Für Entwickler:innen

```bash
git clone https://github.com/Abbas-Hoseiny/pestalozzi.git
cd pestalozzi
npm install
npm run dev
```

Der Build liegt unter `dist/` (`npm run build`). Deployments laufen über GitHub Pages.

## Lizenz

MIT – Nutzung, Anpassung und Weitergabe sind ausdrücklich erlaubt. Wir freuen uns über Feedback und Beiträge über Issues oder Pull Requests.
