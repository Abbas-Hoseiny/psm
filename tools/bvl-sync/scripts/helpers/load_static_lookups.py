"""
Load Static Lookup Data
Loads reference data from CSV files into database tables.
"""

import csv
import logging
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger(__name__)


def load_csv_to_table(db_manager, csv_path: str, table: str) -> int:
    """
    Load CSV data into database table.
    
    Args:
        db_manager: DatabaseManager instance
        csv_path: Path to CSV file
        table: Target table name
        
    Returns:
        Number of records loaded
    """
    if not Path(csv_path).exists():
        logger.warning(f"CSV file not found: {csv_path}")
        return 0
        
    logger.info(f"Loading {csv_path} into {table}")
    
    records = []
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Skip comment lines
                if any(str(val).strip().startswith('#') for val in row.values() if val):
                    continue
                # Skip empty rows
                if not any(row.values()):
                    continue
                records.append(row)
                
        if records:
            count = db_manager.insert_records(table, records)
            logger.info(f"Loaded {count} records from {csv_path} into {table}")
            return count
        else:
            logger.info(f"No records found in {csv_path}")
            return 0
            
    except Exception as e:
        logger.error(f"Failed to load {csv_path}: {e}")
        return 0


def load_static_lookups(db_manager, config: Dict[str, Any]) -> Dict[str, int]:
    """
    Load all static lookup data from configuration.
    
    Args:
        db_manager: DatabaseManager instance
        config: Configuration dictionary with static_sources
        
    Returns:
        Dictionary with counts per table
    """
    counts = {}
    
    static_sources = config.get('static_sources', {})
    
    for source_name, source_config in static_sources.items():
        csv_file = source_config.get('file')
        table = source_config.get('table')
        
        if not csv_file or not table:
            logger.warning(f"Invalid configuration for {source_name}")
            continue
            
        count = load_csv_to_table(db_manager, csv_file, table)
        counts[table] = count
        
    return counts


def enrich_tables_with_lookups(db_manager):
    """
    Enrich tables with lookup data after main data load.
    Fills in wirkstoff_name, hinweis_text, website, etc.
    
    Args:
        db_manager: DatabaseManager instance
    """
    logger.info("Enriching tables with lookup data")
    
    # Enrich mittel_wirkstoff with wirkstoff_name
    sql = """
    UPDATE bvl_mittel_wirkstoff 
    SET wirkstoff_name = (
        SELECT wirkstoff_name 
        FROM bvl_wirkstoff 
        WHERE bvl_wirkstoff.wirkstoff_kode = bvl_mittel_wirkstoff.wirkstoff_kode
    )
    WHERE wirkstoff_kode IS NOT NULL
    """
    count = db_manager.execute_update(sql)
    logger.info(f"Updated {count} wirkstoff names in bvl_mittel_wirkstoff")
    
    # Enrich mittel_ghs_gefahrenhinweis with hinweis_text
    sql = """
    UPDATE bvl_mittel_ghs_gefahrenhinweis 
    SET hinweis_text = (
        SELECT hinweis_text 
        FROM bvl_ghs_gefahrenhinweise 
        WHERE bvl_ghs_gefahrenhinweise.hinweis_kode = bvl_mittel_ghs_gefahrenhinweis.hinweis_kode
    )
    WHERE hinweis_kode IS NOT NULL
    """
    count = db_manager.execute_update(sql)
    logger.info(f"Updated {count} hinweis texts in bvl_mittel_ghs_gefahrenhinweis")
    
    # Enrich mittel_vertrieb with website
    sql = """
    UPDATE bvl_mittel_vertrieb 
    SET website = (
        SELECT website 
        FROM bvl_vertriebsfirma 
        WHERE bvl_vertriebsfirma.firma_name = bvl_mittel_vertrieb.hersteller_name
    )
    WHERE hersteller_name IS NOT NULL
    """
    count = db_manager.execute_update(sql)
    logger.info(f"Updated {count} websites in bvl_mittel_vertrieb")
    
    # Populate bvl_lookup_kultur from bvl_kode (kodeliste 51 = KLTGR/Kulturen)
    sql = """
    INSERT OR REPLACE INTO bvl_lookup_kultur (code, label)
    SELECT kode, kodetext
    FROM bvl_kode
    WHERE kodeliste = 51 AND sprache = 'DE'
    """
    count = db_manager.execute_update(sql)
    logger.info(f"Populated {count} kultur lookups from bvl_kode")
    
    # Populate bvl_lookup_schadorg from bvl_kode (kodeliste 52 = SOORCD/Schadorganismen)
    sql = """
    INSERT OR REPLACE INTO bvl_lookup_schadorg (code, label)
    SELECT kode, kodetext
    FROM bvl_kode
    WHERE kodeliste = 52 AND sprache = 'DE'
    """
    count = db_manager.execute_update(sql)
    logger.info(f"Populated {count} schadorg lookups from bvl_kode")
    
    logger.info("Enrichment completed")


def load_bio_enrichments(db_manager, enrichments_config: Dict[str, Any]):
    """
    Load bio/organic enrichment data.
    
    Args:
        db_manager: DatabaseManager instance
        enrichments_config: Enrichments configuration
    """
    logger.info("Loading bio enrichments")
    
    # Load manual bio flags from CSV
    bio_flags_config = enrichments_config.get('bio_flags', {})
    bio_csv = bio_flags_config.get('file')
    
    if bio_csv and Path(bio_csv).exists():
        count = load_csv_to_table(db_manager, bio_csv, 'bvl_mittel_enrichments')
        logger.info(f"Loaded {count} manual bio flags")
    else:
        logger.info("No bio flags CSV found, skipping manual flags")
    
    # Apply heuristics for bio products
    heuristics = enrichments_config.get('bio_heuristics', {})
    if heuristics.get('enabled', False):
        patterns = heuristics.get('name_patterns', [])
        exclude = heuristics.get('exclude_patterns', [])
        
        if patterns:
            # Build SQL pattern matching
            pattern_conditions = ' OR '.join([f"LOWER(mittelname) LIKE '%{p.lower()}%'" for p in patterns])
            exclude_conditions = ' AND '.join([f"LOWER(mittelname) NOT LIKE '%{e.lower()}%'" for e in exclude])
            
            sql = f"""
            INSERT OR IGNORE INTO bvl_mittel_enrichments (kennr, is_bio, notes, source)
            SELECT kennr, 1, 'Detected by name pattern', 'heuristic'
            FROM bvl_mittel
            WHERE ({pattern_conditions})
            """
            if exclude_conditions:
                sql += f" AND ({exclude_conditions})"
                
            count = db_manager.execute_update(sql)
            logger.info(f"Added {count} bio products via heuristics")
    
    logger.info("Bio enrichments completed")
