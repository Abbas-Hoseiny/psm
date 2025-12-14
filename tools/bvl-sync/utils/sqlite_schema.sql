-- =============================================================================
-- BVL PSM Database Schema - ALL 41 API ENDPOINTS
-- All column names match the official BVL API 1:1
-- Reference: https://github.com/bundesAPI/pflanzenschutzmittelzulassung-api
-- =============================================================================

-- =============================================================================
-- CORE TABLES (10)
-- =============================================================================

-- 1. Stand (API status/date)
CREATE TABLE IF NOT EXISTS bvl_stand (
    id INTEGER PRIMARY KEY DEFAULT 1,
    stand TEXT,
    hinweis TEXT,
    payload_json TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. Mittel (Plant protection products)
CREATE TABLE IF NOT EXISTS bvl_mittel (
    kennr TEXT PRIMARY KEY,
    mittelname TEXT,
    formulierung_art TEXT,
    zul_ende TEXT,
    zul_erstmalig_am TEXT,
    payload_json TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 3. AWG (Application areas)
CREATE TABLE IF NOT EXISTS bvl_awg (
    awg_id TEXT PRIMARY KEY,
    kennr TEXT REFERENCES bvl_mittel(kennr),
    antragnr TEXT,
    awgnr TEXT,
    anwendungsbereich TEXT,
    anwendungstechnik TEXT,
    einsatzgebiet TEXT,
    wirkungsbereich TEXT,
    anwendungen_anz_je_befall INTEGER,
    anwendungen_max_je_kultur INTEGER,
    anwendungen_max_je_vegetation INTEGER,
    stadium_kultur_von TEXT,
    stadium_kultur_bis TEXT,
    stadium_kultur_bem TEXT,
    stadium_kultur_kodeliste TEXT,
    stadium_schadorg_von TEXT,
    stadium_schadorg_bis TEXT,
    stadium_schadorg_bem TEXT,
    stadium_schadorg_kodeliste TEXT,
    kultur_erl TEXT,
    schadorg_erl TEXT,
    genehmigung TEXT,
    huk TEXT,
    aw_abstand_von REAL,
    aw_abstand_bis REAL,
    aw_abstand_einheit TEXT,
    payload_json TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 4. AWG Kultur (cultures per AWG)
CREATE TABLE IF NOT EXISTS bvl_awg_kultur (
    awg_id TEXT REFERENCES bvl_awg(awg_id),
    kultur TEXT,
    ausgenommen TEXT,
    sortier_nr INTEGER,
    PRIMARY KEY (awg_id, kultur)
);

-- 5. AWG Schadorg (pests per AWG)
CREATE TABLE IF NOT EXISTS bvl_awg_schadorg (
    awg_id TEXT REFERENCES bvl_awg(awg_id),
    schadorg TEXT,
    ausgenommen TEXT,
    sortier_nr INTEGER,
    PRIMARY KEY (awg_id, schadorg)
);

-- 6. AWG Aufwand (application rates)
CREATE TABLE IF NOT EXISTS bvl_awg_aufwand (
    awg_id TEXT REFERENCES bvl_awg(awg_id),
    aufwandbedingung TEXT,
    sortier_nr INTEGER,
    m_aufwand REAL,
    m_aufwand_einheit TEXT,
    w_aufwand_von REAL,
    w_aufwand_bis REAL,
    w_aufwand_einheit TEXT,
    PRIMARY KEY (awg_id, sortier_nr)
);

-- 7. AWG Wartezeit (waiting periods)
CREATE TABLE IF NOT EXISTS bvl_awg_wartezeit (
    awg_wartezeit_nr INTEGER PRIMARY KEY,
    awg_id TEXT REFERENCES bvl_awg(awg_id),
    kultur TEXT,
    anwendungsbereich TEXT,
    gesetzt_wartezeit INTEGER,
    gesetzt_wartezeit_bem TEXT,
    erlaeuterung TEXT,
    sortier_nr INTEGER
);

-- 8. Wirkstoff (active substances)
CREATE TABLE IF NOT EXISTS bvl_wirkstoff (
    wirknr TEXT PRIMARY KEY,
    wirkstoffname TEXT,
    wirkstoffname_en TEXT,
    kategorie TEXT,
    genehmigt TEXT,
    payload_json TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 9. Wirkstoff Gehalt (active substance content)
CREATE TABLE IF NOT EXISTS bvl_wirkstoff_gehalt (
    kennr TEXT REFERENCES bvl_mittel(kennr),
    wirknr TEXT REFERENCES bvl_wirkstoff(wirknr),
    wirkvar TEXT,
    gehalt_rein REAL,
    gehalt_rein_grundstruktur REAL,
    gehalt_einheit TEXT,
    gehalt_bio REAL,
    gehalt_bio_einheit TEXT,
    payload_json TEXT,
    PRIMARY KEY (kennr, wirknr, wirkvar)
);

-- 10. Mittel Vertrieb (product distributors)
CREATE TABLE IF NOT EXISTS bvl_mittel_vertrieb (
    kennr TEXT REFERENCES bvl_mittel(kennr),
    vertriebsfirma_nr INTEGER,
    PRIMARY KEY (kennr, vertriebsfirma_nr)
);

-- =============================================================================
-- EXTENDED TABLES (31)
-- =============================================================================

-- 11. Adresse (addresses)
CREATE TABLE IF NOT EXISTS bvl_adresse (
    adresse_nr INTEGER PRIMARY KEY,
    name TEXT,
    strasse TEXT,
    plz TEXT,
    ort TEXT,
    land TEXT,
    telefon TEXT,
    telefax TEXT,
    email TEXT,
    internet TEXT,
    payload_json TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 12. Antrag (applications)
CREATE TABLE IF NOT EXISTS bvl_antrag (
    kennr TEXT,
    antragnr TEXT,
    antragsteller_nr INTEGER,
    zulassungsinhaber_nr INTEGER,
    zulassungsnummer TEXT,
    zulassungsdatum TEXT,
    zul_ende TEXT,
    payload_json TEXT,
    PRIMARY KEY (kennr, antragnr)
);

-- 13. Auflage Redu (reduced requirements)
CREATE TABLE IF NOT EXISTS bvl_auflage_redu (
    auflagenr TEXT PRIMARY KEY,
    auflage TEXT,
    auflage_abstand_redu TEXT,
    auflage_abstand_redu_bem TEXT,
    payload_json TEXT
);

-- 14. Auflagen (requirements)
CREATE TABLE IF NOT EXISTS bvl_auflagen (
    kennr TEXT,
    antragnr TEXT,
    awg_id TEXT,
    ebene TEXT,
    auflagenr TEXT,
    auflage TEXT,
    payload_json TEXT,
    PRIMARY KEY (kennr, awg_id, auflagenr)
);

-- 15. AWG Bemerkungen (AWG remarks)
CREATE TABLE IF NOT EXISTS bvl_awg_bem (
    awg_id TEXT REFERENCES bvl_awg(awg_id),
    bem TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (awg_id, sortier_nr)
);

-- 16. AWG Partner (tank mix partners)
CREATE TABLE IF NOT EXISTS bvl_awg_partner (
    awg_id TEXT REFERENCES bvl_awg(awg_id),
    kennr_partner TEXT,
    partner_typ TEXT,
    partner_bedingung TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (awg_id, kennr_partner)
);

-- 17. AWG Partner Aufwand (partner rates)
CREATE TABLE IF NOT EXISTS bvl_awg_partner_aufwand (
    awg_id TEXT,
    kennr_partner TEXT,
    aufwandbedingung TEXT,
    sortier_nr INTEGER,
    m_aufwand REAL,
    m_aufwand_einheit TEXT,
    payload_json TEXT,
    PRIMARY KEY (awg_id, kennr_partner, sortier_nr)
);

-- 18. AWG Verwendungszweck (intended use)
CREATE TABLE IF NOT EXISTS bvl_awg_verwendungszweck (
    awg_id TEXT REFERENCES bvl_awg(awg_id),
    verwendungszweck TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (awg_id, verwendungszweck)
);

-- 19. AWG Wartezeit Ausg Kultur (waiting period exceptions)
CREATE TABLE IF NOT EXISTS bvl_awg_wartezeit_ausg_kultur (
    awg_wartezeit_nr INTEGER,
    kultur TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (awg_wartezeit_nr, kultur)
);

-- 20. AWG Zeitpunkt (application timing)
CREATE TABLE IF NOT EXISTS bvl_awg_zeitpunkt (
    awg_id TEXT REFERENCES bvl_awg(awg_id),
    zeitpunkt TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (awg_id, zeitpunkt)
);

-- 21. AWG Zulassung (AWG authorization)
CREATE TABLE IF NOT EXISTS bvl_awg_zulassung (
    awg_id TEXT PRIMARY KEY REFERENCES bvl_awg(awg_id),
    zulassungsanfang TEXT,
    zulassungsende TEXT,
    aufbrauchfrist TEXT,
    payload_json TEXT
);

-- 22. GHS Gefahrenhinweise (hazard statements)
CREATE TABLE IF NOT EXISTS bvl_ghs_gefahrenhinweise (
    kennr TEXT,
    hinweis_kode TEXT,
    hinweis_text TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (kennr, hinweis_kode)
);

-- 23. GHS Gefahrensymbole (hazard symbols)
CREATE TABLE IF NOT EXISTS bvl_ghs_gefahrensymbole (
    kennr TEXT,
    symbol_kode TEXT,
    symbol_text TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (kennr, symbol_kode)
);

-- 24. GHS Sicherheitshinweise (safety statements)
CREATE TABLE IF NOT EXISTS bvl_ghs_sicherheitshinweise (
    kennr TEXT,
    hinweis_kode TEXT,
    hinweis_text TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (kennr, hinweis_kode)
);

-- 25. GHS Signalwörter (signal words)
CREATE TABLE IF NOT EXISTS bvl_ghs_signalwoerter (
    kennr TEXT PRIMARY KEY,
    signalwort TEXT,
    payload_json TEXT
);

-- 26. Hinweis (notices)
CREATE TABLE IF NOT EXISTS bvl_hinweis (
    kennr TEXT,
    hinweis_art TEXT,
    hinweis TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (kennr, hinweis_art, sortier_nr)
);

-- 27. Kodeliste (code lists)
CREATE TABLE IF NOT EXISTS bvl_kodeliste (
    kodeliste_nr INTEGER PRIMARY KEY,
    kodeliste_name TEXT,
    kodeliste_bem TEXT,
    payload_json TEXT
);

-- 28. Kodeliste Feldname (field names)
CREATE TABLE IF NOT EXISTS bvl_kodeliste_feldname (
    feld TEXT PRIMARY KEY,
    kodeliste_nr INTEGER,
    payload_json TEXT
);

-- 29. Kode (code values/lookups)
CREATE TABLE IF NOT EXISTS bvl_kode (
    kodeliste INTEGER,
    kode TEXT,
    sprache TEXT,
    kodetext TEXT,
    kodetext2 TEXT,
    payload_json TEXT,
    PRIMARY KEY (kodeliste, kode, sprache)
);

-- 30. Kultur Gruppe (culture groups)
CREATE TABLE IF NOT EXISTS bvl_kultur_gruppe (
    gruppe TEXT,
    kultur TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (gruppe, kultur)
);

-- 31. Mittel Abgelaufen (expired products)
CREATE TABLE IF NOT EXISTS bvl_mittel_abgelaufen (
    kennr TEXT PRIMARY KEY,
    mittelname TEXT,
    zul_ende TEXT,
    aufbrauchfrist TEXT,
    payload_json TEXT
);

-- 32. Mittel Abpackung (package sizes)
CREATE TABLE IF NOT EXISTS bvl_mittel_abpackung (
    kennr TEXT,
    abpackung_menge REAL,
    abpackung_einheit TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (kennr, sortier_nr)
);

-- 33. Mittel Gefahrensymbol (old hazard symbols)
CREATE TABLE IF NOT EXISTS bvl_mittel_gefahren_symbol (
    kennr TEXT,
    gefahren_symbol TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (kennr, gefahren_symbol)
);

-- 34. Mittel Wirkbereich (effect areas)
CREATE TABLE IF NOT EXISTS bvl_mittel_wirkbereich (
    kennr TEXT,
    wirkbereich TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (kennr, wirkbereich)
);

-- 35. Parallelimport Abgelaufen (expired parallel imports)
CREATE TABLE IF NOT EXISTS bvl_parallelimport_abgelaufen (
    kennr TEXT PRIMARY KEY,
    parallelimport_kennr TEXT,
    referenzmittel_kennr TEXT,
    zul_ende TEXT,
    payload_json TEXT
);

-- 36. Parallelimport Gültig (valid parallel imports)
CREATE TABLE IF NOT EXISTS bvl_parallelimport_gueltig (
    kennr TEXT PRIMARY KEY,
    parallelimport_kennr TEXT,
    referenzmittel_kennr TEXT,
    zul_ende TEXT,
    payload_json TEXT
);

-- 37. Schadorg Gruppe (pest groups)
CREATE TABLE IF NOT EXISTS bvl_schadorg_gruppe (
    gruppe TEXT,
    schadorg TEXT,
    sortier_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (gruppe, schadorg)
);

-- 38. Stärkungsmittel (plant strengtheners)
CREATE TABLE IF NOT EXISTS bvl_staerkung (
    kennr TEXT PRIMARY KEY,
    mittelname TEXT,
    antragsteller_nr INTEGER,
    listung_ende TEXT,
    payload_json TEXT
);

-- 39. Stärkungsmittel Vertrieb (strengthener distributors)
CREATE TABLE IF NOT EXISTS bvl_staerkung_vertrieb (
    kennr TEXT,
    vertriebsfirma_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (kennr, vertriebsfirma_nr)
);

-- 40. Zusatzstoff (adjuvants)
CREATE TABLE IF NOT EXISTS bvl_zusatzstoff (
    kennr TEXT PRIMARY KEY,
    mittelname TEXT,
    antragsteller_nr INTEGER,
    zul_ende TEXT,
    payload_json TEXT
);

-- 41. Zusatzstoff Vertrieb (adjuvant distributors)
CREATE TABLE IF NOT EXISTS bvl_zusatzstoff_vertrieb (
    kennr TEXT,
    vertriebsfirma_nr INTEGER,
    payload_json TEXT,
    PRIMARY KEY (kennr, vertriebsfirma_nr)
);

-- =============================================================================
-- INDEXES for faster queries
-- =============================================================================

-- Core indexes
CREATE INDEX IF NOT EXISTS idx_bvl_awg_kennr ON bvl_awg(kennr);
CREATE INDEX IF NOT EXISTS idx_bvl_awg_kultur_awg_id ON bvl_awg_kultur(awg_id);
CREATE INDEX IF NOT EXISTS idx_bvl_awg_kultur_kultur ON bvl_awg_kultur(kultur);
CREATE INDEX IF NOT EXISTS idx_bvl_awg_schadorg_awg_id ON bvl_awg_schadorg(awg_id);
CREATE INDEX IF NOT EXISTS idx_bvl_awg_schadorg_schadorg ON bvl_awg_schadorg(schadorg);
CREATE INDEX IF NOT EXISTS idx_bvl_awg_aufwand_awg_id ON bvl_awg_aufwand(awg_id);
CREATE INDEX IF NOT EXISTS idx_bvl_awg_wartezeit_awg_id ON bvl_awg_wartezeit(awg_id);
CREATE INDEX IF NOT EXISTS idx_bvl_wirkstoff_gehalt_kennr ON bvl_wirkstoff_gehalt(kennr);
CREATE INDEX IF NOT EXISTS idx_bvl_wirkstoff_gehalt_wirknr ON bvl_wirkstoff_gehalt(wirknr);
CREATE INDEX IF NOT EXISTS idx_bvl_mittel_vertrieb_kennr ON bvl_mittel_vertrieb(kennr);
CREATE INDEX IF NOT EXISTS idx_bvl_mittel_zul_ende ON bvl_mittel(zul_ende);
CREATE INDEX IF NOT EXISTS idx_bvl_mittel_mittelname ON bvl_mittel(mittelname);

-- Extended indexes
CREATE INDEX IF NOT EXISTS idx_bvl_antrag_kennr ON bvl_antrag(kennr);
CREATE INDEX IF NOT EXISTS idx_bvl_auflagen_kennr ON bvl_auflagen(kennr);
CREATE INDEX IF NOT EXISTS idx_bvl_auflagen_awg_id ON bvl_auflagen(awg_id);
CREATE INDEX IF NOT EXISTS idx_bvl_awg_bem_awg_id ON bvl_awg_bem(awg_id);
CREATE INDEX IF NOT EXISTS idx_bvl_awg_partner_awg_id ON bvl_awg_partner(awg_id);
CREATE INDEX IF NOT EXISTS idx_bvl_ghs_gefahrenhinweise_kennr ON bvl_ghs_gefahrenhinweise(kennr);
CREATE INDEX IF NOT EXISTS idx_bvl_ghs_gefahrensymbole_kennr ON bvl_ghs_gefahrensymbole(kennr);
CREATE INDEX IF NOT EXISTS idx_bvl_ghs_sicherheitshinweise_kennr ON bvl_ghs_sicherheitshinweise(kennr);
CREATE INDEX IF NOT EXISTS idx_bvl_hinweis_kennr ON bvl_hinweis(kennr);
CREATE INDEX IF NOT EXISTS idx_bvl_kode_kodeliste ON bvl_kode(kodeliste);
CREATE INDEX IF NOT EXISTS idx_bvl_kultur_gruppe_gruppe ON bvl_kultur_gruppe(gruppe);
CREATE INDEX IF NOT EXISTS idx_bvl_schadorg_gruppe_gruppe ON bvl_schadorg_gruppe(gruppe);

-- =============================================================================
-- META TABLE for build/sync tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS bvl_meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ==============================================================================
-- LOOKUP TABLES (derived from bvl_kode for PSM App compatibility)
-- ==============================================================================

-- Kultur Lookup (für schnelles Label-Lookup)
CREATE TABLE IF NOT EXISTS bvl_lookup_kultur (
    code TEXT PRIMARY KEY,
    label TEXT
);

-- Schadorg Lookup (für schnelles Label-Lookup)
CREATE TABLE IF NOT EXISTS bvl_lookup_schadorg (
    code TEXT PRIMARY KEY,
    label TEXT
);

CREATE INDEX IF NOT EXISTS idx_bvl_lookup_kultur_label ON bvl_lookup_kultur(label);
CREATE INDEX IF NOT EXISTS idx_bvl_lookup_schadorg_label ON bvl_lookup_schadorg(label);

-- ==============================================================================
-- ENRICHMENT TABLES (for bio/organic products and extras)
-- ==============================================================================

-- Product active substances relationship
CREATE TABLE IF NOT EXISTS bvl_mittel_wirkstoff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kennr TEXT,
    wirkstoff_kode TEXT,
    wirkstoff_name TEXT,
    gehalt REAL,
    gehalt_einheit TEXT,
    FOREIGN KEY (kennr) REFERENCES bvl_mittel(kennr),
    FOREIGN KEY (wirkstoff_kode) REFERENCES bvl_wirkstoff(wirknr)
);

CREATE INDEX IF NOT EXISTS idx_bvl_mittel_wirkstoff_kennr ON bvl_mittel_wirkstoff(kennr);
CREATE INDEX IF NOT EXISTS idx_bvl_mittel_wirkstoff_kode ON bvl_mittel_wirkstoff(wirkstoff_kode);

-- Bio/organic enrichment data
CREATE TABLE IF NOT EXISTS bvl_mittel_enrichments (
    kennr TEXT PRIMARY KEY,
    is_bio INTEGER DEFAULT 0,
    certification_body TEXT,
    notes TEXT,
    source TEXT,
    FOREIGN KEY (kennr) REFERENCES bvl_mittel(kennr)
);

CREATE INDEX IF NOT EXISTS idx_bvl_mittel_enrichments_bio ON bvl_mittel_enrichments(is_bio);

-- View for products with bio/extras information
CREATE VIEW IF NOT EXISTS bvl_mittel_extras AS
SELECT 
    m.kennr,
    m.mittelname,
    m.zul_ende AS zulassungsende,
    COALESCE(e.is_bio, 0) AS is_bio,
    e.certification_body,
    e.notes,
    e.source
FROM bvl_mittel m
LEFT JOIN bvl_mittel_enrichments e ON m.kennr = e.kennr;

-- ==============================================================================
-- LEGACY COMPATIBILITY TABLES (required by validate_export.py)
-- ==============================================================================

-- Product GHS hazard statements relationship table
CREATE TABLE IF NOT EXISTS bvl_mittel_ghs_gefahrenhinweis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kennr TEXT,
    hinweis_kode TEXT,
    hinweis_text TEXT,
    FOREIGN KEY (kennr) REFERENCES bvl_mittel(kennr),
    FOREIGN KEY (hinweis_kode) REFERENCES bvl_ghs_gefahrenhinweise(kode)
);

CREATE INDEX IF NOT EXISTS idx_bvl_mittel_ghs_kennr ON bvl_mittel_ghs_gefahrenhinweis(kennr);
CREATE INDEX IF NOT EXISTS idx_bvl_mittel_ghs_kode ON bvl_mittel_ghs_gefahrenhinweis(hinweis_kode);

-- Distributor/manufacturer reference table
CREATE TABLE IF NOT EXISTS bvl_vertriebsfirma (
    firma_name TEXT PRIMARY KEY,
    website TEXT,
    adresse TEXT,
    kontakt TEXT
);

-- Sync log table
CREATE TABLE IF NOT EXISTS bvl_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_start TEXT,
    sync_end TEXT,
    duration_seconds REAL,
    status TEXT,
    error_message TEXT,
    records_processed INTEGER DEFAULT 0
);

-- ==============================================================================
-- PSM APP COMPATIBILITY VIEWS
-- Maps pflanzenschutz-db column names to PSM App expected names
-- ==============================================================================

-- Compatibility view for bvl_mittel (name, formulierung, zul_erstmalig)
CREATE VIEW IF NOT EXISTS bvl_mittel_app AS
SELECT 
    kennr,
    mittelname AS name,
    formulierung_art AS formulierung,
    zul_ende,
    zul_erstmalig_am AS zul_erstmalig,
    0 AS geringes_risiko,
    payload_json
FROM bvl_mittel;

-- Meta table for sync tracking (PSM App format)
CREATE TABLE IF NOT EXISTS bvl_meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);
