#!/usr/bin/env python3
"""
Validation Script for BVL Database Export
Validates database structure, content, and data quality.
"""

import argparse
import sqlite3
import sys
import json
import logging
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DatabaseValidator:
    """Validates BVL database export."""
    
    def __init__(self, db_path: str):
        """Initialize validator."""
        self.db_path = db_path
        self.conn = None
        self.errors = []
        self.warnings = []
        
    def connect(self):
        """Connect to database."""
        if not Path(self.db_path).exists():
            raise FileNotFoundError(f"Database not found: {self.db_path}")
            
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        logger.info(f"Connected to {self.db_path}")
        
    def disconnect(self):
        """Disconnect from database."""
        if self.conn:
            self.conn.close()
            
    def check_tables_exist(self):
        """Check that all required tables exist."""
        logger.info("Checking tables exist")
        
        required_tables = [
            'bvl_meta', 'bvl_stand', 'bvl_mittel', 'bvl_awg',
            'bvl_awg_kultur', 'bvl_awg_schadorg', 'bvl_awg_aufwand',
            'bvl_awg_wartezeit', 'bvl_wirkstoff', 'bvl_mittel_wirkstoff',
            'bvl_ghs_gefahrenhinweise', 'bvl_mittel_ghs_gefahrenhinweis',
            'bvl_vertriebsfirma', 'bvl_mittel_vertrieb',
            'bvl_mittel_enrichments'
        ]
        
        cursor = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
        existing_tables = {row[0] for row in cursor.fetchall()}
        
        for table in required_tables:
            if table not in existing_tables:
                self.errors.append(f"Required table missing: {table}")
            else:
                logger.info(f"✓ Table exists: {table}")
                
    def check_view_exists(self):
        """Check that required view exists."""
        logger.info("Checking views exist")
        
        cursor = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='view' AND name='bvl_mittel_extras'"
        )
        
        if cursor.fetchone():
            logger.info("✓ View exists: bvl_mittel_extras")
        else:
            self.errors.append("Required view missing: bvl_mittel_extras")
            
    def check_table_counts(self):
        """Check that critical tables have data."""
        logger.info("Checking table counts")
        
        critical_tables = {
            'bvl_mittel': 100,  # Should have at least 100 products
            'bvl_awg': 10,      # Should have at least 10 application areas
        }
        
        for table, min_count in critical_tables.items():
            cursor = self.conn.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            
            logger.info(f"Table {table}: {count} records")
            
            if count == 0:
                self.errors.append(f"Critical table {table} is empty")
            elif count < min_count:
                self.warnings.append(f"Table {table} has only {count} records (expected >= {min_count})")
            else:
                logger.info(f"✓ Table {table} has sufficient data")
                
    def check_enrichments(self):
        """Check enrichment data quality."""
        logger.info("Checking enrichments")
        
        # Check wirkstoff names are filled
        cursor = self.conn.execute(
            "SELECT COUNT(*) FROM bvl_mittel_wirkstoff WHERE wirkstoff_name IS NULL AND wirkstoff_kode IS NOT NULL"
        )
        null_count = cursor.fetchone()[0]
        
        if null_count > 0:
            self.warnings.append(f"{null_count} wirkstoff records missing wirkstoff_name")
        else:
            logger.info("✓ All wirkstoff names enriched")
            
        # Check GHS hinweis texts are filled
        cursor = self.conn.execute(
            "SELECT COUNT(*) FROM bvl_mittel_ghs_gefahrenhinweis WHERE hinweis_text IS NULL AND hinweis_kode IS NOT NULL"
        )
        null_count = cursor.fetchone()[0]
        
        if null_count > 0:
            self.warnings.append(f"{null_count} GHS records missing hinweis_text")
        else:
            logger.info("✓ All GHS hinweis texts enriched")
            
    def check_bio_data(self):
        """Check bio/organic data."""
        logger.info("Checking bio data")
        
        cursor = self.conn.execute(
            "SELECT COUNT(*) FROM bvl_mittel_extras WHERE is_bio = 1"
        )
        bio_count = cursor.fetchone()[0]
        
        logger.info(f"Bio products: {bio_count}")
        
        if bio_count == 0:
            self.warnings.append("No bio products found (may be intentional)")
        else:
            # Check that bio products have additional info
            cursor = self.conn.execute(
                "SELECT COUNT(*) FROM bvl_mittel_extras WHERE is_bio = 1 AND (certification_body IS NOT NULL OR notes IS NOT NULL)"
            )
            with_info = cursor.fetchone()[0]
            
            logger.info(f"Bio products with info: {with_info}/{bio_count}")
            
    def check_metadata(self):
        """Check metadata is present."""
        logger.info("Checking metadata")
        
        required_meta = ['lastSyncIso', 'dataSource', 'dataSourceType']
        
        for key in required_meta:
            cursor = self.conn.execute(
                "SELECT value FROM bvl_meta WHERE key=?", (key,)
            )
            row = cursor.fetchone()
            
            if row:
                logger.info(f"✓ Metadata {key}: {row[0]}")
            else:
                self.errors.append(f"Required metadata missing: {key}")
                
    def validate(self) -> bool:
        """
        Run all validations.
        
        Returns:
            True if validation passed
        """
        logger.info("Starting validation")
        
        self.connect()
        
        try:
            self.check_tables_exist()
            self.check_view_exists()
            self.check_table_counts()
            self.check_enrichments()
            self.check_bio_data()
            self.check_metadata()
            
            # Print summary
            print("\n" + "="*60)
            print("VALIDATION SUMMARY")
            print("="*60)
            
            if self.errors:
                print(f"\n❌ ERRORS ({len(self.errors)}):")
                for error in self.errors:
                    print(f"  - {error}")
                    
            if self.warnings:
                print(f"\n⚠️  WARNINGS ({len(self.warnings)}):")
                for warning in self.warnings:
                    print(f"  - {warning}")
                    
            if not self.errors and not self.warnings:
                print("\n✅ All validations passed!")
                return True
            elif not self.errors:
                print("\n✅ Validation passed with warnings")
                return True
            else:
                print("\n❌ Validation failed")
                return False
                
        finally:
            self.disconnect()


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Validate BVL database export'
    )
    parser.add_argument(
        'database',
        help='Path to SQLite database file'
    )
    
    args = parser.parse_args()
    
    validator = DatabaseValidator(args.database)
    
    try:
        success = validator.validate()
        return 0 if success else 1
    except Exception as e:
        logger.error(f"Validation failed with error: {e}", exc_info=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
