"""
Database Manager for SQLite operations
Handles schema initialization, record insertion, and data queries.
"""

import sqlite3
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Manages SQLite database operations."""
    
    def __init__(self, db_path: str):
        """
        Initialize database manager.
        
        Args:
            db_path: Path to SQLite database file
        """
        self.db_path = db_path
        self.conn = None
        
    def connect(self):
        """Connect to database."""
        if self.conn is None:
            self.conn = sqlite3.connect(self.db_path)
            self.conn.row_factory = sqlite3.Row
            logger.info(f"Connected to database: {self.db_path}")
            
    def disconnect(self):
        """Disconnect from database."""
        if self.conn:
            self.conn.close()
            self.conn = None
            logger.info("Disconnected from database")
            
    def init_schema(self, schema_path: str):
        """
        Initialize database schema from SQL file.
        
        Args:
            schema_path: Path to SQL schema file
        """
        self.connect()
        
        logger.info(f"Initializing schema from {schema_path}")
        with open(schema_path, 'r', encoding='utf-8') as f:
            schema_sql = f.read()
            
        # Execute schema creation
        self.conn.executescript(schema_sql)
        self.conn.commit()
        logger.info("Schema initialized successfully")
        
    def insert_record(self, table: str, record: Dict[str, Any]) -> bool:
        """
        Insert a single record into table.
        
        Args:
            table: Table name
            record: Record dictionary
            
        Returns:
            True if successful, False otherwise
        """
        if not record:
            return False
            
        self.connect()
        
        # Build INSERT statement
        columns = list(record.keys())
        placeholders = ['?' for _ in columns]
        values = [record[col] for col in columns]
        
        sql = f"INSERT OR REPLACE INTO {table} ({', '.join(columns)}) VALUES ({', '.join(placeholders)})"
        
        try:
            self.conn.execute(sql, values)
            return True
        except sqlite3.Error as e:
            logger.error(f"Failed to insert record into {table}: {e}")
            logger.debug(f"Record: {record}")
            return False
            
    def insert_records(self, table: str, records: List[Dict[str, Any]]) -> int:
        """
        Insert multiple records into table.
        
        Args:
            table: Table name
            records: List of record dictionaries
            
        Returns:
            Number of records successfully inserted
        """
        if not records:
            logger.warning(f"No records to insert into {table}")
            return 0
            
        self.connect()
        
        success_count = 0
        error_count = 0
        
        for record in records:
            if self.insert_record(table, record):
                success_count += 1
            else:
                error_count += 1
                
        # Commit after batch
        self.conn.commit()
        
        logger.info(f"Inserted {success_count} records into {table} (errors: {error_count})")
        return success_count
        
    def execute_query(self, sql: str, params: Optional[tuple] = None) -> List[Dict[str, Any]]:
        """
        Execute SELECT query and return results.
        
        Args:
            sql: SQL query
            params: Query parameters
            
        Returns:
            List of result dictionaries
        """
        self.connect()
        
        try:
            cursor = self.conn.execute(sql, params or ())
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        except sqlite3.Error as e:
            logger.error(f"Query failed: {e}")
            logger.debug(f"SQL: {sql}")
            return []
            
    def execute_update(self, sql: str, params: Optional[tuple] = None) -> int:
        """
        Execute UPDATE/DELETE query.
        
        Args:
            sql: SQL query
            params: Query parameters
            
        Returns:
            Number of affected rows
        """
        self.connect()
        
        try:
            cursor = self.conn.execute(sql, params or ())
            self.conn.commit()
            return cursor.rowcount
        except sqlite3.Error as e:
            logger.error(f"Update failed: {e}")
            logger.debug(f"SQL: {sql}")
            return 0
            
    def get_table_count(self, table: str) -> int:
        """
        Get record count for table.
        
        Args:
            table: Table name
            
        Returns:
            Number of records
        """
        results = self.execute_query(f"SELECT COUNT(*) as count FROM {table}")
        return results[0]["count"] if results else 0
        
    def table_exists(self, table: str) -> bool:
        """
        Check if table exists.
        
        Args:
            table: Table name
            
        Returns:
            True if table exists
        """
        sql = "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        results = self.execute_query(sql, (table,))
        return len(results) > 0
        
    def view_exists(self, view_name: str) -> bool:
        """
        Check if view exists.
        
        Args:
            view_name: View name
            
        Returns:
            True if view exists
        """
        sql = "SELECT name FROM sqlite_master WHERE type='view' AND name=?"
        results = self.execute_query(sql, (view_name,))
        return len(results) > 0
        
    def set_meta(self, key: str, value: str):
        """
        Set metadata value.
        
        Args:
            key: Metadata key
            value: Metadata value
        """
        self.connect()
        sql = "INSERT OR REPLACE INTO bvl_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))"
        self.conn.execute(sql, (key, value))
        self.conn.commit()
        
    def get_meta(self, key: str) -> Optional[str]:
        """
        Get metadata value.
        
        Args:
            key: Metadata key
            
        Returns:
            Metadata value or None
        """
        results = self.execute_query("SELECT value FROM bvl_meta WHERE key=?", (key,))
        return results[0]["value"] if results else None
        
    def vacuum(self):
        """Vacuum database to optimize size."""
        self.connect()
        logger.info("Running VACUUM to optimize database")
        self.conn.execute("VACUUM")
        
    def __enter__(self):
        """Context manager entry."""
        self.connect()
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.disconnect()
