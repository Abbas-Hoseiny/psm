"""
HTTP Client for BVL API
Handles API requests with proper URL building, pagination, retry logic, and error handling.
"""

import logging
import time
from typing import Dict, List, Optional, Any
import requests

logger = logging.getLogger(__name__)


class HTTPClient:
    """HTTP client for fetching data from BVL API with pagination support."""
    
    def __init__(
        self,
        base_url: str,
        timeout: int = 30,
        max_retries: int = 3,
        retry_delay: int = 2
    ):
        """
        Initialize HTTP client.
        
        Args:
            base_url: Base URL for API (should end with /)
            timeout: Request timeout in seconds
            max_retries: Maximum number of retry attempts
            retry_delay: Delay between retries in seconds
        """
        self.base_url = base_url.rstrip('/') + '/'
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.session = requests.Session()
        
    def _build_url(self, path: str) -> str:
        """
        Build full URL from base URL and path.
        Ensures correct URL construction without using urljoin which has issues.
        
        Args:
            path: Relative path (without leading slash)
            
        Returns:
            Full URL
        """
        # Remove leading slash from path if present
        path = path.lstrip('/')
        # Combine base URL and path
        url = self.base_url + path
        logger.debug(f"Built URL: {url}")
        return url
        
    def get(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        retry_count: int = 0
    ) -> Optional[Dict[str, Any]]:
        """
        Send GET request to API endpoint.
        
        Args:
            path: Endpoint path (relative, without leading slash)
            params: Query parameters
            retry_count: Current retry attempt number
            
        Returns:
            JSON response as dictionary, or None on error
        """
        url = self._build_url(path)
        
        try:
            logger.debug(f"GET {url} with params: {params}")
            response = self.session.get(url, params=params, timeout=self.timeout)
            
            # Handle HTTP 204 No Content
            if response.status_code == 204:
                logger.warning(f"No content returned from {url}")
                return {"items": []}
            
            response.raise_for_status()
            
            # Try to parse JSON
            try:
                data = response.json()
                return data
            except ValueError as e:
                logger.error(f"Failed to parse JSON from {url}: {e}")
                return None
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Request failed for {url}: {e}")
            
            # Retry logic
            if retry_count < self.max_retries:
                wait_time = self.retry_delay * (2 ** retry_count)  # Exponential backoff
                logger.info(f"Retrying in {wait_time} seconds... (attempt {retry_count + 1}/{self.max_retries})")
                time.sleep(wait_time)
                return self.get(path, params, retry_count + 1)
            else:
                logger.error(f"Max retries exceeded for {url}")
                return None
                
    def fetch_paginated(
        self,
        path: str,
        page_size: int = 1000,
        max_pages: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Fetch all records from paginated endpoint.
        
        Args:
            path: Endpoint path (relative, without leading slash)
            page_size: Number of records per page
            max_pages: Maximum number of pages to fetch (None for all)
            
        Returns:
            List of all records from all pages
        """
        all_records = []
        offset = 0
        page_num = 0
        
        while True:
            if max_pages and page_num >= max_pages:
                logger.info(f"Reached max pages limit ({max_pages})")
                break
                
            params = {
                'limit': page_size,
                'offset': offset
            }
            
            logger.info(f"Fetching page {page_num + 1} from {path} (offset={offset}, limit={page_size})")
            data = self.get(path, params)
            
            if not data:
                logger.warning(f"No data returned for page {page_num + 1}")
                break
                
            # Extract items from response
            items = data.get('items', [])
            
            if not items:
                logger.info(f"No more items found at offset {offset}")
                break
                
            all_records.extend(items)
            logger.info(f"Fetched {len(items)} records (total: {len(all_records)})")
            
            # Check if we've reached the end
            if len(items) < page_size:
                logger.info(f"Received fewer records than page size, assuming end of data")
                break
                
            offset += page_size
            page_num += 1
            
        logger.info(f"Completed fetching {path}: {len(all_records)} total records")
        return all_records
        
    def close(self):
        """Close the HTTP session."""
        self.session.close()
