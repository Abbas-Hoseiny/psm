"""
Unit tests for database operations.
All table names have bvl_ prefix to match pflanzenschutz-db schema.
"""

import pytest
import tempfile
from pathlib import Path
from scripts.helpers.database import DatabaseManager


@pytest.fixture
def temp_db():
    """Create temporary database for testing."""
    with tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False) as f:
        db_path = f.name
        
    yield db_path
    
    # Cleanup
    Path(db_path).unlink(missing_ok=True)


@pytest.fixture
def db_manager(temp_db):
    """Create database manager with initialized schema."""
    manager = DatabaseManager(temp_db)
    manager.init_schema('utils/sqlite_schema.sql')
    return manager


def test_init_schema(temp_db):
    """Test schema initialization."""
    manager = DatabaseManager(temp_db)
    manager.init_schema('utils/sqlite_schema.sql')
    
    # Check core tables exist (with bvl_ prefix)
    assert manager.table_exists('bvl_mittel')
    assert manager.table_exists('bvl_awg')
    assert manager.table_exists('bvl_awg_kultur')
    assert manager.table_exists('bvl_awg_aufwand')
    assert manager.table_exists('bvl_awg_wartezeit')
    assert manager.table_exists('bvl_wirkstoff')
    assert manager.table_exists('bvl_meta')
    
    # Check extended tables
    assert manager.table_exists('bvl_ghs_gefahrenhinweise')
    assert manager.table_exists('bvl_adresse')


def test_insert_record(db_manager):
    """Test inserting single record."""
    record = {
        'kennr': '024123-00',
        'mittelname': 'Test Product',
        'formulierung_art': 'SC',
        'zul_ende': '2025-12-31'
    }
    
    success = db_manager.insert_record('bvl_mittel', record)
    assert success
    
    # Verify record was inserted
    count = db_manager.get_table_count('bvl_mittel')
    assert count == 1


def test_insert_records(db_manager):
    """Test inserting multiple records."""
    records = [
        {'kennr': '024123-00', 'mittelname': 'Product 1'},
        {'kennr': '024123-01', 'mittelname': 'Product 2'},
        {'kennr': '024123-02', 'mittelname': 'Product 3'}
    ]
    
    count = db_manager.insert_records('bvl_mittel', records)
    assert count == 3
    
    # Verify records were inserted
    total = db_manager.get_table_count('bvl_mittel')
    assert total == 3


def test_execute_query(db_manager):
    """Test executing SELECT query."""
    # Insert test data
    db_manager.insert_record('bvl_mittel', {
        'kennr': '024123-00',
        'mittelname': 'Test Product'
    })
    
    # Query data
    results = db_manager.execute_query(
        "SELECT * FROM bvl_mittel WHERE kennr = ?",
        ('024123-00',)
    )
    
    assert len(results) == 1
    assert results[0]['mittelname'] == 'Test Product'


def test_set_and_get_meta(db_manager):
    """Test metadata operations."""
    db_manager.set_meta('test_key', 'test_value')
    
    value = db_manager.get_meta('test_key')
    assert value == 'test_value'
    
    # Test non-existent key
    value = db_manager.get_meta('nonexistent')
    assert value is None


def test_table_count(db_manager):
    """Test getting table record count."""
    assert db_manager.get_table_count('bvl_mittel') == 0
    
    db_manager.insert_record('bvl_mittel', {
        'kennr': '024123-00',
        'mittelname': 'Test'
    })
    
    assert db_manager.get_table_count('bvl_mittel') == 1


def test_context_manager(temp_db):
    """Test database manager as context manager."""
    manager = DatabaseManager(temp_db)
    manager.init_schema('utils/sqlite_schema.sql')
    
    with manager as db:
        db.insert_record('bvl_mittel', {
            'kennr': '024123-00',
            'mittelname': 'Test'
        })
        
    # Connection should be closed
    assert manager.conn is None


def test_awg_aufwand_official_fields(db_manager):
    """Test that bvl_awg_aufwand uses official API field names."""
    record = {
        'awg_id': 12345,
        'aufwandbedingung': 'AB',
        'sortier_nr': 1,
        'm_aufwand': 1.5,  # Official API field name!
        'm_aufwand_einheit': 'L_HA',
        'w_aufwand_von': 200,
        'w_aufwand_bis': 400,
        'w_aufwand_einheit': 'L_HA'
    }
    
    success = db_manager.insert_record('bvl_awg_aufwand', record)
    assert success
    
    results = db_manager.execute_query("SELECT m_aufwand FROM bvl_awg_aufwand WHERE awg_id = 12345")
    assert results[0]['m_aufwand'] == 1.5


def test_awg_wartezeit_official_fields(db_manager):
    """Test that bvl_awg_wartezeit uses official API field names."""
    record = {
        'awg_wartezeit_nr': 99999,
        'awg_id': 12345,
        'kultur': 'TRZAW',
        'anwendungsbereich': 'FX',
        'gesetzt_wartezeit': 35,  # Official API field name!
        'gesetzt_wartezeit_bem': 'F',  # Official API field name!
        'erlaeuterung': 'Nach Festsetzung',
        'sortier_nr': 1
    }
    
    success = db_manager.insert_record('bvl_awg_wartezeit', record)
    assert success
    
    results = db_manager.execute_query("SELECT gesetzt_wartezeit FROM bvl_awg_wartezeit WHERE awg_wartezeit_nr = 99999")
    assert results[0]['gesetzt_wartezeit'] == 35
