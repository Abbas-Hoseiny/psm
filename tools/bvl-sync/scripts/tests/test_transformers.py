"""
Unit tests for transformers/mappers - ALL 40 BVL API endpoints.
"""

import pytest
import json
from scripts.helpers.transformers import (
    map_stand_record,
    map_mittel_record,
    map_awg_record,
    map_awg_kultur_record,
    map_awg_schadorg_record,
    map_awg_aufwand_record,
    map_awg_wartezeit_record,
    map_wirkstoff_record,
    map_wirkstoff_gehalt_record,
    map_mittel_vertrieb_record,
    map_adresse_record,
    map_antrag_record,
    map_auflagen_record,
    map_awg_bem_record,
    map_awg_partner_record,
    map_awg_partner_aufwand_record,
    map_awg_zulassung_record,
    map_ghs_gefahrenhinweise_record,
    map_ghs_gefahrensymbole_record,
    map_ghs_sicherheitshinweise_record,
    map_ghs_signalwoerter_record,
    map_hinweis_record,
    map_kode_record,
    map_kultur_gruppe_record,
    map_schadorg_gruppe_record,
    get_mapper,
    get_all_endpoints,
    RECORD_MAPPERS
)


# =============================================================================
# CORE ENDPOINTS TESTS (10)
# =============================================================================

def test_map_stand_record():
    """Test stand record mapping."""
    raw = {"datum": "2024-01-15", "hinweis": "Test hinweis", "extra": "ignored"}
    result = map_stand_record(raw)
    
    assert result["id"] == 1
    assert result["stand"] == "2024-01-15"
    assert result["hinweis"] == "Test hinweis"
    assert "payload_json" in result
    payload = json.loads(result["payload_json"])
    assert payload["datum"] == "2024-01-15"


def test_map_mittel_record():
    """Test mittel record mapping with official API fields."""
    raw = {
        "kennr": "024123-00",
        "mittelname": "Test Produkt",
        "formulierung_art": "SC",
        "zul_ende": "2025-12-31",
        "zul_erstmalig_am": "2020-01-01"
    }
    result = map_mittel_record(raw)
    
    assert result["kennr"] == "024123-00"
    assert result["mittelname"] == "Test Produkt"
    assert result["formulierung_art"] == "SC"
    assert result["zul_ende"] == "2025-12-31"
    assert result["zul_erstmalig_am"] == "2020-01-01"


def test_map_awg_record():
    """Test AWG record mapping with all official API fields."""
    raw = {
        "awg_id": 12345,
        "kennr": "024123-00",
        "antragnr": "ANT-001",
        "awgnr": "1",
        "anwendungsbereich": "FX",
        "anwendungstechnik": "SS",
        "einsatzgebiet": "FL",
        "wirkungsbereich": "FUNGIZID",
        "anwendungen_max_je_vegetation": 3,
        "stadium_kultur_von": "BBCH 10",
        "stadium_kultur_bis": "BBCH 89",
        "kultur_erl": "nur Winterweizen",
        "genehmigung": "N",
        "huk": "N"
    }
    result = map_awg_record(raw)
    
    assert result["awg_id"] == 12345
    assert result["kennr"] == "024123-00"
    assert result["anwendungsbereich"] == "FX"
    assert result["wirkungsbereich"] == "FUNGIZID"
    assert result["stadium_kultur_von"] == "BBCH 10"
    assert result["kultur_erl"] == "nur Winterweizen"


def test_map_awg_kultur_record():
    """Test AWG kultur mapping - uses 'kultur' NOT 'kultur_kode'."""
    raw = {"awg_id": 12345, "kultur": "TRZAW", "ausgenommen": "N", "sortier_nr": 1}
    result = map_awg_kultur_record(raw)
    
    assert result["awg_id"] == 12345
    assert result["kultur"] == "TRZAW"  # Official API field name!
    assert result["ausgenommen"] == "N"


def test_map_awg_schadorg_record():
    """Test AWG schadorg mapping - uses 'schadorg' NOT 'schadorg_kode'."""
    raw = {"awg_id": 12345, "schadorg": "SEPTTR", "ausgenommen": "N", "sortier_nr": 1}
    result = map_awg_schadorg_record(raw)
    
    assert result["awg_id"] == 12345
    assert result["schadorg"] == "SEPTTR"  # Official API field name!


def test_map_awg_aufwand_record():
    """Test AWG aufwand mapping with official API field names."""
    raw = {
        "awg_id": 12345,
        "aufwandbedingung": "AB",
        "sortier_nr": 1,
        "m_aufwand": 1.5,  # NOT mittel_aufwand!
        "m_aufwand_einheit": "L_HA",
        "w_aufwand_von": 200,
        "w_aufwand_bis": 400,
        "w_aufwand_einheit": "L_HA"
    }
    result = map_awg_aufwand_record(raw)
    
    assert result["awg_id"] == 12345
    assert result["m_aufwand"] == 1.5  # Official API field name!
    assert result["m_aufwand_einheit"] == "L_HA"
    assert result["w_aufwand_von"] == 200
    assert result["w_aufwand_bis"] == 400


def test_map_awg_wartezeit_record():
    """Test AWG wartezeit mapping with official API field names."""
    raw = {
        "awg_wartezeit_nr": 99999,
        "awg_id": 12345,
        "kultur": "TRZAW",
        "anwendungsbereich": "FX",
        "gesetzt_wartezeit": 35,  # NOT tage!
        "gesetzt_wartezeit_bem": "F",  # NOT bemerkung_kode!
        "erlaeuterung": "Nach Festsetzung",
        "sortier_nr": 1
    }
    result = map_awg_wartezeit_record(raw)
    
    assert result["awg_wartezeit_nr"] == 99999
    assert result["gesetzt_wartezeit"] == 35  # Official API field name!
    assert result["gesetzt_wartezeit_bem"] == "F"  # Official API field name!
    assert result["kultur"] == "TRZAW"


def test_map_wirkstoff_record():
    """Test wirkstoff record mapping."""
    raw = {
        "wirknr": "0757",
        "wirkstoffname": "Azoxystrobin",
        "wirkstoffname_en": "Azoxystrobin",
        "kategorie": "F",
        "genehmigt": "J"
    }
    result = map_wirkstoff_record(raw)
    
    assert result["wirknr"] == "0757"
    assert result["wirkstoffname"] == "Azoxystrobin"
    assert result["genehmigt"] == "J"


def test_map_wirkstoff_gehalt_record():
    """Test wirkstoff_gehalt mapping with BVL API field names."""
    raw = {
        "kennr": "024123-00",
        "wirknr": "0757",
        "wirkvar": "X00",
        "gehalt_rein": 0,
        "gehalt_rein_grundstruktur": 8.25,
        "gehalt_einheit": "GL",
        "gehalt_bio": None,
        "gehalt_bio_einheit": None
    }
    result = map_wirkstoff_gehalt_record(raw)
    
    assert result["kennr"] == "024123-00"
    assert result["wirknr"] == "0757"
    assert result["gehalt_rein_grundstruktur"] == 8.25
    assert result["gehalt_einheit"] == "GL"


def test_map_mittel_vertrieb_record():
    """Test mittel_vertrieb mapping."""
    raw = {"kennr": "024123-00", "vertriebsfirma_nr": 12345}
    result = map_mittel_vertrieb_record(raw)
    
    assert result["kennr"] == "024123-00"
    assert result["vertriebsfirma_nr"] == 12345


# =============================================================================
# EXTENDED ENDPOINTS TESTS (30)
# =============================================================================

def test_map_adresse_record():
    """Test adresse record mapping."""
    raw = {
        "adresse_nr": 12345,
        "name": "BASF SE",
        "strasse": "Speyerer Str. 2",
        "plz": "67117",
        "ort": "Limburgerhof",
        "land": "DE"
    }
    result = map_adresse_record(raw)
    
    assert result["adresse_nr"] == 12345
    assert result["name"] == "BASF SE"
    assert result["ort"] == "Limburgerhof"


def test_map_antrag_record():
    """Test antrag record mapping."""
    raw = {
        "kennr": "024123-00",
        "antragnr": "ANT-001",
        "antragsteller_nr": 100,
        "zulassungsnummer": "024123-00/00",
        "zulassungsdatum": "2020-01-01"
    }
    result = map_antrag_record(raw)
    
    assert result["kennr"] == "024123-00"
    assert result["antragnr"] == "ANT-001"
    assert result["zulassungsnummer"] == "024123-00/00"


def test_map_auflagen_record():
    """Test auflagen record mapping."""
    raw = {
        "kennr": "024123-00",
        "awg_id": 12345,
        "ebene": "P",
        "auflagenr": "NW642",
        "auflage": "Abstand zu Gewässern 10m"
    }
    result = map_auflagen_record(raw)
    
    assert result["kennr"] == "024123-00"
    assert result["auflagenr"] == "NW642"
    assert result["ebene"] == "P"


def test_map_awg_bem_record():
    """Test awg_bem record mapping."""
    raw = {"awg_id": 12345, "bem": "Nur bei Befall", "sortier_nr": 1}
    result = map_awg_bem_record(raw)
    
    assert result["awg_id"] == 12345
    assert result["bem"] == "Nur bei Befall"


def test_map_awg_partner_record():
    """Test awg_partner (tank mix) record mapping."""
    raw = {
        "awg_id": 12345,
        "kennr_partner": "033456-00",
        "partner_typ": "TM",
        "partner_bedingung": "AB",
        "sortier_nr": 1
    }
    result = map_awg_partner_record(raw)
    
    assert result["awg_id"] == 12345
    assert result["kennr_partner"] == "033456-00"
    assert result["partner_typ"] == "TM"


def test_map_awg_partner_aufwand_record():
    """Test awg_partner_aufwand record mapping."""
    raw = {
        "awg_id": 12345,
        "kennr_partner": "033456-00",
        "aufwandbedingung": "AB",
        "m_aufwand": 0.5,
        "m_aufwand_einheit": "L_HA"
    }
    result = map_awg_partner_aufwand_record(raw)
    
    assert result["awg_id"] == 12345
    assert result["m_aufwand"] == 0.5


def test_map_awg_zulassung_record():
    """Test awg_zulassung record mapping."""
    raw = {
        "awg_id": 12345,
        "zulassungsanfang": "2020-01-01",
        "zulassungsende": "2025-12-31",
        "aufbrauchfrist": "2026-06-30"
    }
    result = map_awg_zulassung_record(raw)
    
    assert result["awg_id"] == 12345
    assert result["zulassungsende"] == "2025-12-31"
    assert result["aufbrauchfrist"] == "2026-06-30"


def test_map_ghs_gefahrenhinweise_record():
    """Test GHS hazard statements mapping."""
    raw = {
        "kennr": "024123-00",
        "hinweis_kode": "H400",
        "hinweis_text": "Sehr giftig für Wasserorganismen",
        "sortier_nr": 1
    }
    result = map_ghs_gefahrenhinweise_record(raw)
    
    assert result["kennr"] == "024123-00"
    assert result["hinweis_kode"] == "H400"
    assert "payload_json" in result


def test_map_ghs_gefahrensymbole_record():
    """Test GHS hazard symbols mapping."""
    raw = {
        "kennr": "024123-00",
        "symbol_kode": "GHS09",
        "symbol_text": "Umwelt",
        "sortier_nr": 1
    }
    result = map_ghs_gefahrensymbole_record(raw)
    
    assert result["kennr"] == "024123-00"
    assert result["symbol_kode"] == "GHS09"


def test_map_ghs_sicherheitshinweise_record():
    """Test GHS safety statements mapping."""
    raw = {
        "kennr": "024123-00",
        "hinweis_kode": "P391",
        "hinweis_text": "Verschüttete Mengen aufnehmen",
        "sortier_nr": 1
    }
    result = map_ghs_sicherheitshinweise_record(raw)
    
    assert result["hinweis_kode"] == "P391"


def test_map_ghs_signalwoerter_record():
    """Test GHS signal words mapping."""
    raw = {"kennr": "024123-00", "signalwort": "Achtung"}
    result = map_ghs_signalwoerter_record(raw)
    
    assert result["kennr"] == "024123-00"
    assert result["signalwort"] == "Achtung"


def test_map_hinweis_record():
    """Test hinweis (notice) record mapping."""
    raw = {
        "kennr": "024123-00",
        "hinweis_art": "AW",
        "hinweis": "Nur im Freiland",
        "sortier_nr": 1
    }
    result = map_hinweis_record(raw)
    
    assert result["kennr"] == "024123-00"
    assert result["hinweis_art"] == "AW"


def test_map_kode_record():
    """Test kode (lookup) record mapping."""
    raw = {
        "kodeliste": 948,
        "kode": "TRZAW",
        "sprache": "DE",
        "kodetext": "Weizen",
        "kodetext2": "Triticum aestivum"
    }
    result = map_kode_record(raw)
    
    assert result["kodeliste"] == 948
    assert result["kode"] == "TRZAW"
    assert result["kodetext"] == "Weizen"


def test_map_kultur_gruppe_record():
    """Test kultur_gruppe record mapping."""
    raw = {"gruppe": "GETREIDE", "kultur": "TRZAW", "sortier_nr": 1}
    result = map_kultur_gruppe_record(raw)
    
    assert result["gruppe"] == "GETREIDE"
    assert result["kultur"] == "TRZAW"


def test_map_schadorg_gruppe_record():
    """Test schadorg_gruppe record mapping."""
    raw = {"gruppe": "PILZE", "schadorg": "SEPTTR", "sortier_nr": 1}
    result = map_schadorg_gruppe_record(raw)
    
    assert result["gruppe"] == "PILZE"
    assert result["schadorg"] == "SEPTTR"


# =============================================================================
# REGISTRY TESTS
# =============================================================================

def test_get_mapper():
    """Test mapper registry lookup."""
    assert get_mapper("stand") == map_stand_record
    assert get_mapper("mittel") == map_mittel_record
    assert get_mapper("awg") == map_awg_record
    assert get_mapper("awg_aufwand") == map_awg_aufwand_record
    assert get_mapper("awg_wartezeit") == map_awg_wartezeit_record
    assert get_mapper("ghs_gefahrenhinweise") == map_ghs_gefahrenhinweise_record
    assert get_mapper("nonexistent") is None


def test_get_all_endpoints():
    """Test that all 40 endpoints are registered."""
    endpoints = get_all_endpoints()
    
    # Must have at least 40 endpoints
    assert len(endpoints) >= 40
    
    # Core endpoints
    assert "stand" in endpoints
    assert "mittel" in endpoints
    assert "awg" in endpoints
    assert "awg_kultur" in endpoints
    assert "awg_schadorg" in endpoints
    assert "awg_aufwand" in endpoints
    assert "awg_wartezeit" in endpoints
    assert "wirkstoff" in endpoints
    assert "wirkstoff_gehalt" in endpoints
    assert "mittel_vertrieb" in endpoints
    
    # Extended endpoints
    assert "adresse" in endpoints
    assert "antrag" in endpoints
    assert "auflagen" in endpoints
    assert "awg_bem" in endpoints
    assert "awg_partner" in endpoints
    assert "awg_partner_aufwand" in endpoints
    assert "awg_zulassung" in endpoints
    assert "ghs_gefahrenhinweise" in endpoints
    assert "ghs_gefahrensymbole" in endpoints
    assert "ghs_sicherheitshinweise" in endpoints
    assert "ghs_signalwoerter" in endpoints
    assert "hinweis" in endpoints
    assert "kode" in endpoints
    assert "kultur_gruppe" in endpoints
    assert "schadorg_gruppe" in endpoints
    assert "staerkung" in endpoints
    assert "zusatzstoff" in endpoints


def test_all_mappers_return_dict():
    """Test that all mappers return a dictionary."""
    empty_record = {}
    
    for endpoint_name, mapper in RECORD_MAPPERS.items():
        result = mapper(empty_record)
        assert isinstance(result, dict), f"{endpoint_name} mapper did not return dict"


def test_missing_fields_handled_gracefully():
    """Test that mappers handle missing fields without raising exceptions."""
    raw = {}
    
    # Should not raise any exceptions
    result = map_mittel_record(raw)
    assert result["kennr"] is None
    assert result["mittelname"] is None
    
    result = map_awg_aufwand_record(raw)
    assert result["m_aufwand"] is None
    
    result = map_awg_wartezeit_record(raw)
    assert result["gesetzt_wartezeit"] is None
