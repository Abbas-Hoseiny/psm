"""
Unit tests for HTTP client.
"""

import pytest
from scripts.helpers.http_client import HTTPClient


def test_build_url_without_slash():
    """Test URL building with path without leading slash."""
    client = HTTPClient("https://psm-api.bvl.bund.de/ords/psm/api-v1/")
    url = client._build_url("mittel")
    assert url == "https://psm-api.bvl.bund.de/ords/psm/api-v1/mittel"


def test_build_url_with_slash():
    """Test URL building with path with leading slash."""
    client = HTTPClient("https://psm-api.bvl.bund.de/ords/psm/api-v1/")
    url = client._build_url("/mittel")
    assert url == "https://psm-api.bvl.bund.de/ords/psm/api-v1/mittel"


def test_build_url_base_without_trailing_slash():
    """Test URL building when base URL doesn't have trailing slash."""
    client = HTTPClient("https://psm-api.bvl.bund.de/ords/psm/api-v1")
    url = client._build_url("mittel")
    assert url == "https://psm-api.bvl.bund.de/ords/psm/api-v1/mittel"


def test_build_url_complex_path():
    """Test URL building with complex path."""
    client = HTTPClient("https://psm-api.bvl.bund.de/ords/psm/api-v1/")
    url = client._build_url("mittel/123/details")
    assert url == "https://psm-api.bvl.bund.de/ords/psm/api-v1/mittel/123/details"
