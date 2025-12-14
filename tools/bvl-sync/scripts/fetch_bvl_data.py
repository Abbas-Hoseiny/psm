#!/usr/bin/env python3
"""
BVL Data Fetch Script
Main ETL pipeline for fetching and processing BVL plant protection data.
"""

import argparse
import logging
import sys
import yaml
from pathlib import Path
from datetime import datetime
from typing import Dict, Any

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parent))

from helpers.http_client import HTTPClient
from helpers.database import DatabaseManager
from helpers.transformers import get_mapper
from helpers.load_static_lookups import (
    load_static_lookups,
    enrich_tables_with_lookups,
    load_bio_enrichments
)
from helpers.compression import compress_database
from helpers.manifest import generate_manifest

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class ETLPipeline:
    """Main ETL pipeline for BVL data."""
    
    def __init__(
        self,
        config_path: str,
        enrichments_config_path: str,
        schema_path: str,
        output_dir: str,
        skip_raw: bool = False
    ):
        """
        Initialize ETL pipeline.
        
        Args:
            config_path: Path to endpoints config
            enrichments_config_path: Path to enrichments config
            schema_path: Path to SQL schema
            output_dir: Output directory for database
            skip_raw: Skip raw data download
        """
        self.config_path = config_path
        self.enrichments_config_path = enrichments_config_path
        self.schema_path = schema_path
        self.output_dir = Path(output_dir)
        self.skip_raw = skip_raw
        
        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Load configurations
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
            
        with open(enrichments_config_path, 'r', encoding='utf-8') as f:
            self.enrichments_config = yaml.safe_load(f)
            
        # Initialize components
        self.db_path = self.output_dir / "pflanzenschutz.sqlite"
        self.db_manager = DatabaseManager(str(self.db_path))
        self.http_client = HTTPClient(self.config['base_url'])
        
        # Stats
        self.stats = {
            'start_time': None,
            'end_time': None,
            'endpoints': {},
            'errors': []
        }
        
    def init_database(self):
        """Initialize database with schema."""
        logger.info("Initializing database schema")
        self.db_manager.init_schema(self.schema_path)
        
        # Set initial metadata
        self.db_manager.set_meta('dataSource', 'BVL PSM API')
        self.db_manager.set_meta('dataSourceType', 'api-v1')
        
    def fetch_endpoint_data(self, endpoint: Dict[str, Any]) -> int:
        """
        Fetch data for a single endpoint.
        
        Args:
            endpoint: Endpoint configuration
            
        Returns:
            Number of records fetched
        """
        name = endpoint['name']
        path = endpoint['path']
        table = endpoint['table']
        
        logger.info(f"Fetching data for endpoint: {name}")
        
        try:
            # Fetch records
            records = self.http_client.fetch_paginated(path)
            
            if not records:
                logger.warning(f"No records fetched for {name}")
                self.stats['endpoints'][name] = {
                    'count': 0,
                    'status': 'empty'
                }
                return 0
                
            # Transform records
            mapper = get_mapper(name)
            if not mapper:
                logger.error(f"No mapper found for {name}")
                self.stats['endpoints'][name] = {
                    'count': 0,
                    'status': 'error',
                    'error': 'No mapper found'
                }
                return 0
                
            mapped_records = []
            for record in records:
                try:
                    mapped = mapper(record)
                    mapped_records.append(mapped)
                except Exception as e:
                    logger.error(f"Failed to map record in {name}: {e}")
                    continue
                    
            # Insert into database
            count = self.db_manager.insert_records(table, mapped_records)
            
            logger.info(f"Inserted {count} records into {table}")
            
            self.stats['endpoints'][name] = {
                'count': count,
                'status': 'success'
            }
            
            return count
            
        except Exception as e:
            logger.error(f"Failed to fetch {name}: {e}")
            self.stats['endpoints'][name] = {
                'count': 0,
                'status': 'error',
                'error': str(e)
            }
            self.stats['errors'].append(f"{name}: {str(e)}")
            return 0
            
    def fetch_all_endpoints(self):
        """Fetch data from all configured endpoints."""
        logger.info("Fetching data from all endpoints")
        
        endpoints = self.config.get('endpoints', [])
        
        for endpoint in endpoints:
            self.fetch_endpoint_data(endpoint)
            
    def load_static_data(self):
        """Load static lookup data."""
        logger.info("Loading static lookup data")
        counts = load_static_lookups(self.db_manager, self.config)
        
        for table, count in counts.items():
            self.stats['endpoints'][f'static_{table}'] = {
                'count': count,
                'status': 'success'
            }
            
    def enrich_data(self):
        """Enrich data with lookups and bio information."""
        logger.info("Enriching data")
        
        # Enrich with lookups
        enrich_tables_with_lookups(self.db_manager)
        
        # Load bio enrichments
        load_bio_enrichments(self.db_manager, self.enrichments_config)
        
    def validate_database(self):
        """Validate database contents."""
        logger.info("Validating database")
        
        # Check critical tables have data
        critical_tables = ['bvl_mittel', 'bvl_awg']
        
        for table in critical_tables:
            count = self.db_manager.get_table_count(table)
            logger.info(f"Table {table}: {count} records")
            
            if count == 0:
                error_msg = f"Critical table {table} is empty!"
                logger.error(error_msg)
                self.stats['errors'].append(error_msg)
                
        # Check view exists
        if not self.db_manager.view_exists('bvl_mittel_extras'):
            error_msg = "View bvl_mittel_extras does not exist!"
            logger.error(error_msg)
            self.stats['errors'].append(error_msg)
            
        # Get all table counts
        table_counts = {}
        tables = [
            'bvl_stand', 'bvl_mittel', 'bvl_awg', 'bvl_awg_kultur',
            'bvl_awg_schadorg', 'bvl_awg_aufwand', 'bvl_awg_wartezeit',
            'bvl_wirkstoff', 'bvl_mittel_wirkstoff', 'bvl_mittel_vertrieb',
            'bvl_mittel_enrichments'
        ]
        
        for table in tables:
            if self.db_manager.table_exists(table):
                table_counts[table] = self.db_manager.get_table_count(table)
                
        # Update metadata
        import json
        self.db_manager.set_meta('lastSyncIso', datetime.utcnow().isoformat() + 'Z')
        self.db_manager.set_meta('lastSyncCounts', json.dumps(table_counts))
        
        # Get API stand date
        stand_results = self.db_manager.execute_query("SELECT stand FROM bvl_stand LIMIT 1")
        if stand_results:
            self.db_manager.set_meta('apiStand', stand_results[0]['stand'])
            
        return table_counts
        
    def compress_and_manifest(self, table_counts: dict):
        """Compress database and generate manifest."""
        logger.info("Compressing database")
        
        # Vacuum first
        self.db_manager.vacuum()
        
        # Compress
        compression_results = compress_database(
            str(self.db_path),
            str(self.output_dir)
        )
        
        # Generate manifest
        end_dt = datetime.utcnow()
        start_dt = datetime.fromisoformat(self.stats['start_time'].rstrip('Z'))
        
        build_info = {
            'start_time': self.stats['start_time'],
            'end_time': end_dt.isoformat() + 'Z',
            'duration_seconds': (end_dt - start_dt).total_seconds(),
            'api_version': 'v1',
            'runner': 'github-actions'
        }
        
        manifest_path = generate_manifest(
            str(self.db_path),
            str(self.output_dir),
            compression_results,
            table_counts,
            build_info
        )
        
        logger.info(f"Manifest generated: {manifest_path}")
        
    def run(self):
        """Run the complete ETL pipeline."""
        logger.info("Starting ETL pipeline")
        start_dt = datetime.utcnow()
        self.stats['start_time'] = start_dt.isoformat() + 'Z'
        
        try:
            # Initialize database
            self.init_database()
            
            # Load static data first
            self.load_static_data()
            
            # Fetch API data
            if not self.skip_raw:
                self.fetch_all_endpoints()
            else:
                logger.info("Skipping raw data fetch (--skip-raw)")
                
            # Enrich data
            self.enrich_data()
            
            # Validate
            table_counts = self.validate_database()
            
            # Compress and manifest
            self.compress_and_manifest(table_counts)
            
            end_dt = datetime.utcnow()
            self.stats['end_time'] = end_dt.isoformat() + 'Z'
            
            # Check for errors
            if self.stats['errors']:
                logger.error(f"Pipeline completed with {len(self.stats['errors'])} errors:")
                for error in self.stats['errors']:
                    logger.error(f"  - {error}")
                return 1
            else:
                logger.info("Pipeline completed successfully")
                return 0
                
        except Exception as e:
            logger.error(f"Pipeline failed: {e}", exc_info=True)
            self.stats['errors'].append(str(e))
            return 1
            
        finally:
            self.db_manager.disconnect()
            self.http_client.close()
            

def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Fetch and process BVL plant protection data'
    )
    parser.add_argument(
        '--config',
        default='configs/endpoints.yaml',
        help='Path to endpoints configuration'
    )
    parser.add_argument(
        '--enrichments-config',
        default='configs/enrichments.yaml',
        help='Path to enrichments configuration'
    )
    parser.add_argument(
        '--schema',
        default='utils/sqlite_schema.sql',
        help='Path to SQL schema file'
    )
    parser.add_argument(
        '--output-dir',
        default='data/output',
        help='Output directory for database'
    )
    parser.add_argument(
        '--skip-raw',
        action='store_true',
        help='Skip fetching raw data from API'
    )
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Enable verbose logging'
    )
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
        
    # Run pipeline
    pipeline = ETLPipeline(
        args.config,
        args.enrichments_config,
        args.schema,
        args.output_dir,
        args.skip_raw
    )
    
    return pipeline.run()


if __name__ == '__main__':
    sys.exit(main())
