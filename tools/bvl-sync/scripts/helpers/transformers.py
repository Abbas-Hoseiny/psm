"""
Data Transformers/Mappers for BVL API Records

Transforms raw API responses into database-ready records.
IMPORTANT: All field names must match the official BVL API 1:1!
See: https://github.com/bundesAPI/pflanzenschutzmittelzulassung-api

Supports ALL 40 BVL API endpoints.
"""

import json
import logging
from typing import Dict, Any, Optional, Callable

logger = logging.getLogger(__name__)


# =============================================================================
# CORE ENDPOINTS (10) - Stored in dedicated tables
# =============================================================================

def map_stand_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map stand (status) record. API: /stand/"""
    return {
        "id": 1,
        "stand": record.get("datum"),
        "hinweis": record.get("hinweis"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_mittel_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map mittel (product) record. API: /mittel/"""
    return {
        "kennr": record.get("kennr"),
        "mittelname": record.get("mittelname"),
        "formulierung_art": record.get("formulierung_art"),
        "zul_ende": record.get("zul_ende"),
        "zul_erstmalig_am": record.get("zul_erstmalig_am"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_awg_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map AWG (application area) record. API: /awg/"""
    return {
        "awg_id": record.get("awg_id"),
        "kennr": record.get("kennr"),
        "antragnr": record.get("antragnr"),
        "awgnr": record.get("awgnr"),
        "anwendungsbereich": record.get("anwendungsbereich"),
        "anwendungstechnik": record.get("anwendungstechnik"),
        "einsatzgebiet": record.get("einsatzgebiet"),
        "wirkungsbereich": record.get("wirkungsbereich"),
        "anwendungen_anz_je_befall": record.get("anwendungen_anz_je_befall"),
        "anwendungen_max_je_kultur": record.get("anwendungen_max_je_kultur"),
        "anwendungen_max_je_vegetation": record.get("anwendungen_max_je_vegetation"),
        "stadium_kultur_von": record.get("stadium_kultur_von"),
        "stadium_kultur_bis": record.get("stadium_kultur_bis"),
        "stadium_kultur_bem": record.get("stadium_kultur_bem"),
        "stadium_kultur_kodeliste": record.get("stadium_kultur_kodeliste"),
        "stadium_schadorg_von": record.get("stadium_schadorg_von"),
        "stadium_schadorg_bis": record.get("stadium_schadorg_bis"),
        "stadium_schadorg_bem": record.get("stadium_schadorg_bem"),
        "stadium_schadorg_kodeliste": record.get("stadium_schadorg_kodeliste"),
        "kultur_erl": record.get("kultur_erl"),
        "schadorg_erl": record.get("schadorg_erl"),
        "genehmigung": record.get("genehmigung"),
        "huk": record.get("huk"),
        "aw_abstand_von": record.get("aw_abstand_von"),
        "aw_abstand_bis": record.get("aw_abstand_bis"),
        "aw_abstand_einheit": record.get("aw_abstand_einheit"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_awg_kultur_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map AWG kultur record. API: /awg_kultur/"""
    return {
        "awg_id": record.get("awg_id"),
        "kultur": record.get("kultur"),
        "ausgenommen": record.get("ausgenommen"),
        "sortier_nr": record.get("sortier_nr")
    }


def map_awg_schadorg_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map AWG schadorganismus record. API: /awg_schadorg/"""
    return {
        "awg_id": record.get("awg_id"),
        "schadorg": record.get("schadorg"),
        "ausgenommen": record.get("ausgenommen"),
        "sortier_nr": record.get("sortier_nr")
    }


def map_awg_aufwand_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map AWG aufwand (application rate) record. API: /awg_aufwand/"""
    return {
        "awg_id": record.get("awg_id"),
        "aufwandbedingung": record.get("aufwandbedingung"),
        "sortier_nr": record.get("sortier_nr"),
        "m_aufwand": record.get("m_aufwand"),
        "m_aufwand_einheit": record.get("m_aufwand_einheit"),
        "w_aufwand_von": record.get("w_aufwand_von"),
        "w_aufwand_bis": record.get("w_aufwand_bis"),
        "w_aufwand_einheit": record.get("w_aufwand_einheit")
    }


def map_awg_wartezeit_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map AWG wartezeit (waiting period) record. API: /awg_wartezeit/"""
    return {
        "awg_wartezeit_nr": record.get("awg_wartezeit_nr"),
        "awg_id": record.get("awg_id"),
        "kultur": record.get("kultur"),
        "anwendungsbereich": record.get("anwendungsbereich"),
        "gesetzt_wartezeit": record.get("gesetzt_wartezeit"),
        "gesetzt_wartezeit_bem": record.get("gesetzt_wartezeit_bem"),
        "erlaeuterung": record.get("erlaeuterung"),
        "sortier_nr": record.get("sortier_nr")
    }


def map_wirkstoff_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map wirkstoff (active substance) record. API: /wirkstoff/"""
    return {
        "wirknr": record.get("wirknr"),
        "wirkstoffname": record.get("wirkstoffname"),
        "wirkstoffname_en": record.get("wirkstoffname_en"),
        "kategorie": record.get("kategorie"),
        "genehmigt": record.get("genehmigt"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_wirkstoff_gehalt_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map wirkstoff_gehalt record. API: /wirkstoff_gehalt/"""
    return {
        "kennr": record.get("kennr"),
        "wirknr": record.get("wirknr"),
        "wirkvar": record.get("wirkvar"),
        "gehalt_rein": record.get("gehalt_rein"),
        "gehalt_rein_grundstruktur": record.get("gehalt_rein_grundstruktur"),
        "gehalt_einheit": record.get("gehalt_einheit"),
        "gehalt_bio": record.get("gehalt_bio"),
        "gehalt_bio_einheit": record.get("gehalt_bio_einheit"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_mittel_vertrieb_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map mittel vertrieb record. API: /mittel_vertrieb/"""
    return {
        "kennr": record.get("kennr"),
        "vertriebsfirma_nr": record.get("vertriebsfirma_nr")
    }


# =============================================================================
# EXTENDED ENDPOINTS (30+) - Stored in dedicated tables
# =============================================================================

def map_adresse_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map adresse (address) record. API: /adresse/"""
    return {
        "adresse_nr": record.get("adresse_nr"),
        "name": record.get("name"),
        "strasse": record.get("strasse"),
        "plz": record.get("plz"),
        "ort": record.get("ort"),
        "land": record.get("land"),
        "telefon": record.get("telefon"),
        "telefax": record.get("telefax"),
        "email": record.get("email"),
        "internet": record.get("internet"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_antrag_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map antrag (application) record. API: /antrag/"""
    return {
        "kennr": record.get("kennr"),
        "antragnr": record.get("antragnr"),
        "antragsteller_nr": record.get("antragsteller_nr"),
        "zulassungsinhaber_nr": record.get("zulassungsinhaber_nr"),
        "zulassungsnummer": record.get("zulassungsnummer"),
        "zulassungsdatum": record.get("zulassungsdatum"),
        "zul_ende": record.get("zul_ende"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_auflage_redu_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map auflage_redu record. API: /auflage_redu/"""
    return {
        "auflagenr": record.get("auflagenr"),
        "auflage": record.get("auflage"),
        "auflage_abstand_redu": record.get("auflage_abstand_redu"),
        "auflage_abstand_redu_bem": record.get("auflage_abstand_redu_bem"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_auflagen_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map auflagen record. API: /auflagen/"""
    return {
        "kennr": record.get("kennr"),
        "antragnr": record.get("antragnr"),
        "awg_id": record.get("awg_id"),
        "ebene": record.get("ebene"),
        "auflagenr": record.get("auflagenr"),
        "auflage": record.get("auflage"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_awg_bem_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map awg_bem (AWG remarks) record. API: /awg_bem/"""
    return {
        "awg_id": record.get("awg_id"),
        "bem": record.get("bem"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_awg_partner_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map awg_partner record. API: /awg_partner/"""
    return {
        "awg_id": record.get("awg_id"),
        "kennr_partner": record.get("kennr_partner"),
        "partner_typ": record.get("partner_typ"),
        "partner_bedingung": record.get("partner_bedingung"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_awg_partner_aufwand_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map awg_partner_aufwand record. API: /awg_partner_aufwand/"""
    return {
        "awg_id": record.get("awg_id"),
        "kennr_partner": record.get("kennr_partner"),
        "aufwandbedingung": record.get("aufwandbedingung"),
        "sortier_nr": record.get("sortier_nr"),
        "m_aufwand": record.get("m_aufwand"),
        "m_aufwand_einheit": record.get("m_aufwand_einheit"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_awg_verwendungszweck_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map awg_verwendungszweck record. API: /awg_verwendungszweck/"""
    return {
        "awg_id": record.get("awg_id"),
        "verwendungszweck": record.get("verwendungszweck"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_awg_wartezeit_ausg_kultur_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map awg_wartezeit_ausg_kultur record. API: /awg_wartezeit_ausg_kultur/"""
    return {
        "awg_wartezeit_nr": record.get("awg_wartezeit_nr"),
        "kultur": record.get("kultur"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_awg_zeitpunkt_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map awg_zeitpunkt record. API: /awg_zeitpunkt/"""
    return {
        "awg_id": record.get("awg_id"),
        "zeitpunkt": record.get("zeitpunkt"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_awg_zulassung_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map awg_zulassung record. API: /awg_zulassung/"""
    return {
        "awg_id": record.get("awg_id"),
        "zulassungsanfang": record.get("zulassungsanfang"),
        "zulassungsende": record.get("zulassungsende"),
        "aufbrauchfrist": record.get("aufbrauchfrist"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_ghs_gefahrenhinweise_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map ghs_gefahrenhinweise record. API: /ghs_gefahrenhinweise/"""
    return {
        "kennr": record.get("kennr"),
        "hinweis_kode": record.get("hinweis_kode"),
        "hinweis_text": record.get("hinweis_text"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_ghs_gefahrensymbole_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map ghs_gefahrensymbole record. API: /ghs_gefahrensymbole/"""
    return {
        "kennr": record.get("kennr"),
        "symbol_kode": record.get("symbol_kode"),
        "symbol_text": record.get("symbol_text"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_ghs_sicherheitshinweise_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map ghs_sicherheitshinweise record. API: /ghs_sicherheitshinweise/"""
    return {
        "kennr": record.get("kennr"),
        "hinweis_kode": record.get("hinweis_kode"),
        "hinweis_text": record.get("hinweis_text"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_ghs_signalwoerter_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map ghs_signalwoerter record. API: /ghs_signalwoerter/"""
    return {
        "kennr": record.get("kennr"),
        "signalwort": record.get("signalwort"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_hinweis_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map hinweis record. API: /hinweis/"""
    return {
        "kennr": record.get("kennr"),
        "hinweis_art": record.get("hinweis_art"),
        "hinweis": record.get("hinweis"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_kodeliste_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map kodeliste record. API: /kodeliste/"""
    return {
        "kodeliste_nr": record.get("kodeliste_nr"),
        "kodeliste_name": record.get("kodeliste_name"),
        "kodeliste_bem": record.get("kodeliste_bem"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_kodeliste_feldname_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map kodeliste_feldname record. API: /kodeliste_feldname/"""
    return {
        "feld": record.get("feld"),
        "kodeliste_nr": record.get("kodeliste_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_kode_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map kode record. API: /kode/"""
    return {
        "kodeliste": record.get("kodeliste"),
        "kode": record.get("kode"),
        "sprache": record.get("sprache"),
        "kodetext": record.get("kodetext"),
        "kodetext2": record.get("kodetext2"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_kultur_gruppe_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map kultur_gruppe record. API: /kultur_gruppe/"""
    return {
        "gruppe": record.get("gruppe"),
        "kultur": record.get("kultur"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_mittel_abgelaufen_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map mittel_abgelaufen record. API: /mittel_abgelaufen/"""
    return {
        "kennr": record.get("kennr"),
        "mittelname": record.get("mittelname"),
        "zul_ende": record.get("zul_ende"),
        "aufbrauchfrist": record.get("aufbrauchfrist"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_mittel_abpackung_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map mittel_abpackung record. API: /mittel_abpackung/"""
    return {
        "kennr": record.get("kennr"),
        "abpackung_menge": record.get("abpackung_menge"),
        "abpackung_einheit": record.get("abpackung_einheit"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_mittel_gefahren_symbol_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map mittel_gefahren_symbol record. API: /mittel_gefahren_symbol/"""
    return {
        "kennr": record.get("kennr"),
        "gefahren_symbol": record.get("gefahren_symbol"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_mittel_wirkbereich_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map mittel_wirkbereich record. API: /mittel_wirkbereich/"""
    return {
        "kennr": record.get("kennr"),
        "wirkbereich": record.get("wirkbereich"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_parallelimport_abgelaufen_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map parallelimport_abgelaufen record. API: /parallelimport_abgelaufen/"""
    return {
        "kennr": record.get("kennr"),
        "parallelimport_kennr": record.get("parallelimport_kennr"),
        "referenzmittel_kennr": record.get("referenzmittel_kennr"),
        "zul_ende": record.get("zul_ende"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_parallelimport_gueltig_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map parallelimport_gueltig record. API: /parallelimport_gueltig/"""
    return {
        "kennr": record.get("kennr"),
        "parallelimport_kennr": record.get("parallelimport_kennr"),
        "referenzmittel_kennr": record.get("referenzmittel_kennr"),
        "zul_ende": record.get("zul_ende"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_schadorg_gruppe_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map schadorg_gruppe record. API: /schadorg_gruppe/"""
    return {
        "gruppe": record.get("gruppe"),
        "schadorg": record.get("schadorg"),
        "sortier_nr": record.get("sortier_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_staerkung_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map staerkung record. API: /staerkung/"""
    return {
        "kennr": record.get("kennr"),
        "mittelname": record.get("mittelname"),
        "antragsteller_nr": record.get("antragsteller_nr"),
        "listung_ende": record.get("listung_ende"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_staerkung_vertrieb_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map staerkung_vertrieb record. API: /staerkung_vertrieb/"""
    return {
        "kennr": record.get("kennr"),
        "vertriebsfirma_nr": record.get("vertriebsfirma_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_zusatzstoff_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map zusatzstoff record. API: /zusatzstoff/"""
    return {
        "kennr": record.get("kennr"),
        "mittelname": record.get("mittelname"),
        "antragsteller_nr": record.get("antragsteller_nr"),
        "zul_ende": record.get("zul_ende"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


def map_zusatzstoff_vertrieb_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Map zusatzstoff_vertrieb record. API: /zusatzstoff_vertrieb/"""
    return {
        "kennr": record.get("kennr"),
        "vertriebsfirma_nr": record.get("vertriebsfirma_nr"),
        "payload_json": json.dumps(record, ensure_ascii=False)
    }


# =============================================================================
# REGISTRY - All 40 endpoint mappers
# =============================================================================

RECORD_MAPPERS: Dict[str, Callable] = {
    # Core (10)
    "stand": map_stand_record,
    "mittel": map_mittel_record,
    "awg": map_awg_record,
    "awg_kultur": map_awg_kultur_record,
    "awg_schadorg": map_awg_schadorg_record,
    "awg_aufwand": map_awg_aufwand_record,
    "awg_wartezeit": map_awg_wartezeit_record,
    "wirkstoff": map_wirkstoff_record,
    "wirkstoff_gehalt": map_wirkstoff_gehalt_record,
    "mittel_vertrieb": map_mittel_vertrieb_record,
    # Extended (30)
    "adresse": map_adresse_record,
    "antrag": map_antrag_record,
    "auflage_redu": map_auflage_redu_record,
    "auflagen": map_auflagen_record,
    "awg_bem": map_awg_bem_record,
    "awg_partner": map_awg_partner_record,
    "awg_partner_aufwand": map_awg_partner_aufwand_record,
    "awg_verwendungszweck": map_awg_verwendungszweck_record,
    "awg_wartezeit_ausg_kultur": map_awg_wartezeit_ausg_kultur_record,
    "awg_zeitpunkt": map_awg_zeitpunkt_record,
    "awg_zulassung": map_awg_zulassung_record,
    "ghs_gefahrenhinweise": map_ghs_gefahrenhinweise_record,
    "ghs_gefahrensymbole": map_ghs_gefahrensymbole_record,
    "ghs_sicherheitshinweise": map_ghs_sicherheitshinweise_record,
    "ghs_signalwoerter": map_ghs_signalwoerter_record,
    "hinweis": map_hinweis_record,
    "kodeliste": map_kodeliste_record,
    "kodeliste_feldname": map_kodeliste_feldname_record,
    "kode": map_kode_record,
    "kultur_gruppe": map_kultur_gruppe_record,
    "mittel_abgelaufen": map_mittel_abgelaufen_record,
    "mittel_abpackung": map_mittel_abpackung_record,
    "mittel_gefahren_symbol": map_mittel_gefahren_symbol_record,
    "mittel_wirkbereich": map_mittel_wirkbereich_record,
    "parallelimport_abgelaufen": map_parallelimport_abgelaufen_record,
    "parallelimport_gueltig": map_parallelimport_gueltig_record,
    "schadorg_gruppe": map_schadorg_gruppe_record,
    "staerkung": map_staerkung_record,
    "staerkung_vertrieb": map_staerkung_vertrieb_record,
    "zusatzstoff": map_zusatzstoff_record,
    "zusatzstoff_vertrieb": map_zusatzstoff_vertrieb_record,
}


def get_mapper(endpoint_name: str) -> Optional[Callable]:
    """Get mapper function for endpoint."""
    mapper = RECORD_MAPPERS.get(endpoint_name)
    if not mapper:
        logger.warning(f"No mapper found for endpoint: {endpoint_name}")
    return mapper


def get_all_endpoints() -> list:
    """Get list of all supported endpoints."""
    return list(RECORD_MAPPERS.keys())
