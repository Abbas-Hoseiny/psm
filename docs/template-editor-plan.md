# Template-Editor Plan (Vorlage-Bereich)

> Kontext: Umsetzung innerhalb der Anwendung **Pflanzenschutz-Aufzeichnung**.

## 1. Technologie-Entscheidungen

| Aspekt       | Entscheidung                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Rendering    | Weiterhin Vanilla TypeScript + DOM-APIs (kein zusätzliches Framework)                          |
| Drag/Resize  | Nutzung von `interact.js` (CDN) für Drag/Drop & Resize mit Grid-Snap                           |
| Styling      | Eigenes CSS-Modul unter `src/styles/template-editor.css`, ergänzt durch bestehendes Layout CSS |
| Persistenz   | Verbindung zu neuem Template-Store über `core/database` und EventBus                           |
| Zustand/Undo | Transient state in neuem Modul `templateEditorStore.ts` (immutable Snapshots für Undo/Redo)    |

## 2. Modul-Struktur

```
src/
└── scripts/
    └── features/
        └── templates/
            ├── index.ts            // Entry: initTemplateEditor(container, services)
            ├── editorView.ts       // DOM-Aufbau und Rendering
            ├── editorState.ts      // Transient state (selected field, selection box, grid)
            ├── interactions.ts     // Drag/Drop/Resize mit interact.js
            ├── commands.ts         // Undo/Redo-Command-Pattern
            ├── propertyPanel.ts    // Rechte Sidebar (Formulare)
            ├── palette.ts          // Linke Sidebar (Bausteine + Vorlagenliste)
            └── utils/
                ├── grid.ts         // Rasterberechnung (px ↔ Grid Units)
                ├── layout.ts       // Layout Normalisierung & Constraints
                └── serializer.ts   // Mapping State ↔ Template JSON
```

## 3. Layout-Aufbau

### HTML-Grundstruktur

```html
<section class="template-editor">
  <header class="template-editor__toolbar">...</header>
  <div class="template-editor__body">
    <aside class="template-editor__sidebar template-editor__sidebar--left">
      ...
    </aside>
    <main class="template-editor__canvas">
      <div class="template-editor__paper">
        <div class="template-editor__grid"></div>
        <!-- Dynamisch: platzierte Felder -->
      </div>
    </main>
    <aside class="template-editor__sidebar template-editor__sidebar--right">
      ...
    </aside>
  </div>
</section>
```

### Grid & Maße

- A4-Format in px bei 96 dpi: 794 × 1123. Innen Abzug 32 px (Padding).
- Raster: 12 Spalten × 16 Zeilen → Zellen ca. 60 × 60 px.
- `interact.js` Snap auf Raster (`rect.left = n * cellWidth`).
- Papierbereich kann skaliert werden (Zoom) – Standard 0.85 to fit.

## 4. State-Modell

```typescript
interface EditorState {
  templateId: string | null;
  name: string;
  description: string;
  layoutMeta: LayoutMeta;
  fields: EditorField[];
  selectedFieldIds: string[];
  selectionBox: SelectionBox | null;
  snapping: boolean;
  gridVisible: boolean;
  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];
  dirty: boolean;
}

interface EditorField {
  id: string;
  type: FieldType;
  name: string;
  label: string;
  placeholder: string;
  required: boolean;
  validation: ValidationConfig;
  defaultValue: string | number | null;
  layout: {
    x: number; // grid column start (0-based)
    y: number; // grid row start (0-based)
    w: number; // grid width in columns
    h: number; // grid height in rows
    layer: number;
    align: "left" | "center" | "right";
  };
  printStyles: Record<string, unknown>;
}
```

- `EditorSnapshot` speichert flaches Objekt mit `fields`, `layoutMeta`, `selectedFieldIds` → `undo/redo`.
- `commands.ts` implementiert `execute(Command)` → `undoStack.push(snapshot)`.

## 5. Interaktionen & Workflows

1. **Vorlage laden**
   - `palette.ts` ruft `listTemplates()`.
   - Auswahl → `editorState.load(template)` → `fields` + `layoutMeta` setzen, Undo/Redo reset.
2. **Baustein hinzufügen**
   - Klick/Drag auf Palette → `createField(type)` mit Default-Layout (`x=0,y=0,w=3,h=2`).
   - Bei Drag: Ghost-Element, Drop-Lokation via Grid-Koordinaten.
   - Feld-ID (UUID) generieren, `state.fields.push`.
3. **Feld verschieben/skalieren**
   - `interactions.ts` registriert interact.js Draggable/Resizable.
   - On move -> Update layout (mit Snap), mark dirty, Trigger Live-Preview.
4. **Mehrfachauswahl**
   - Shift-Klick → toggle `selectedFieldIds`.
   - Rechteckauswahl: Maus auf Canvas → `selectionBox` berechnen, Felder ermitteln.
5. **Kontextmenü (Rechtsklick)**
   - `Duplicate`, `Delete`, `Move to Front/Back`.
   - Implementation: Custom context menu overlay.
6. **Eigenschaften bearbeiten**
   - `propertyPanel.ts` rendert Form (Name, Label, Placeholder, Validation, Layout parameter).
   - Änderungen → `state.updateField(fieldId, patch)`.
7. **Toolbar**
   - Buttons:
     - `Neu` → state reset.
     - `Speichern` → `saveTemplate(currentState)` (Upsert), Feedback Toast.
     - `Speichern unter` → `duplicateTemplate`, set new `id`.
     - `Undo/Redo` → Pop Stacks.
     - `Grid`, `Snap` toggles.
8. **Vorschau**
   - Render A4-Layout in Modal (read-only) via `printStyles`. Option `PDF` via existing `print.ts` Pipeline.

## 6. Persistenz-Anbindung

- `serializer.ts` konvertiert `EditorState` ↔ `TemplateDefinition`.
- `saveTemplate` sendet: `{ template: meta, fields, diff }` (diff optional → `template_history`).
- Später: `template_history` zur Anzeige in "Änderungsverlauf" (Timeline in Sidebar).

## 7. CSS-Skizze

- `template-editor.css` enthält BEM-Klassen.
- Grid: `background-size: 60px 60px; background-image: linear-gradient(...)`.
- Cards/Buttons via vorhandene Bootstrap-Klassen (farblich abgestimmt).

## 8. Externe Ressourcen

- `interact.js` via CDN: `https://cdn.jsdelivr.net/npm/@interactjs/interactjs/dist/interact.min.js`.
- Polyfill nicht nötig (ESM Build, Module import). Integration über `<script type="module"> import interact from '...'; </script>` im Feature-Modul.

## 9. Offene Punkte

- Zoom-Funktion: optional später (nicht MVP).
- Feldtypen-Erweiterung: In der Palette als disabled Placeholder rendern.
- Barrierefreiheit: Keyboard-Navigation für Auswahl (Tabbing) → separate Task.

## 10. Implementation Roadmap (Schritt 2)

1. Layout & Styling (Sidebar, Canvas, Toolbar) – statische DOM-Struktur.
2. State-/Command-Struktur aufsetzen (undo/redo, selection).
3. Palette + Feld hinzufügen.
4. Drag/Resize mit Grid.
5. Property-Panel + Binding.
6. Speichern/Laden über Persistenz-API.
7. UX-Finishing: Kontextmenü, Mehrfachauswahl, Preview.
8. Tests + Doku.

Dieses Dokument dient als Grundlage für die Umsetzung des Vorlagen-Editors.
