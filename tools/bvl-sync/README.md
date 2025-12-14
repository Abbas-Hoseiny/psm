# BVL Pflanzenschutzmittel Database

Automated ETL pipeline for fetching and processing plant protection product data from the German Federal Office of Consumer Protection and Food Safety (BVL) API.

## Overview

This project provides a complete data pipeline that:
- Fetches data from the BVL PSM API (10 endpoints)
- Transforms and validates the data
- Enriches with bio/organic information
- Exports to SQLite database with compression
- Publishes to GitHub Pages for web access

## Features

- **Complete API Coverage**: Fetches from all 10 BVL API endpoints
- **Bio/Organic Enrichment**: Combines manual CSV flags with heuristic detection
- **Lookups & References**: Enriches data with GHS hazard statements, active substance names, manufacturer websites
- **Multiple Formats**: SQLite, Brotli-compressed, and ZIP formats
- **Manifest File**: JSON manifest with file hashes, sizes, and metadata
- **Automated Testing**: Unit and integration tests
- **CI/CD**: Daily automated builds via GitHub Actions

## Quick Start

### Installation

```bash
# Clone repository
git clone https://github.com/Abbas-Hoseiny/pflanzenschutz-db.git
cd pflanzenschutz-db

# Install dependencies
pip install -r requirements.txt
```

### Running the Pipeline

```bash
# Fetch and process data
python scripts/fetch_bvl_data.py --output-dir data/output

# Validate output
python scripts/validate_export.py data/output/pflanzenschutz.sqlite
```

### Running Tests

```bash
pytest scripts/tests/ -v
```

## Project Structure

```
pflanzenschutz-db/
├── configs/
│   ├── endpoints.yaml          # API endpoint configuration
│   └── enrichments.yaml        # Bio enrichment configuration
├── data/
│   ├── external/               # External data (bio flags, etc.)
│   ├── static/                 # Static lookup data (GHS, etc.)
│   └── output/                 # Generated database files
├── scripts/
│   ├── helpers/
│   │   ├── http_client.py      # HTTP client with pagination
│   │   ├── database.py         # Database operations
│   │   ├── transformers.py     # Data mappers
│   │   ├── compression.py      # Compression utilities
│   │   ├── manifest.py         # Manifest generation
│   │   └── load_static_lookups.py  # Static data loader
│   ├── tests/                  # Test suite
│   ├── fetch_bvl_data.py       # Main ETL script
│   └── validate_export.py      # Validation script
├── utils/
│   └── sqlite_schema.sql       # Database schema
└── .github/workflows/
    └── build-and-publish.yml   # CI/CD workflow
```

## Database Schema

### Main Tables

- **bvl_mittel**: Plant protection products (main table)
- **bvl_awg**: Application areas
- **bvl_awg_kultur**: Application cultures
- **bvl_awg_schadorg**: Pest organisms
- **bvl_awg_aufwand**: Application rates
- **bvl_awg_wartezeit**: Waiting periods
- **bvl_wirkstoff**: Active substances
- **bvl_mittel_wirkstoff**: Product-substance relationships
- **bvl_mittel_vertrieb**: Product distributors
- **bvl_mittel_ghs_gefahrenhinweis**: GHS hazard statements

### Enrichment Tables

- **bvl_mittel_enrichments**: Bio/organic certification data
- **bvl_mittel_extras** (view): Combined product and enrichment data

### Metadata Tables

- **bvl_meta**: Metadata key-value pairs
- **bvl_sync_log**: Synchronization history

## Data Sources & Bio Handling

### Primary Data Source
- **BVL PSM API v1**: https://psm-api.bvl.bund.de/ords/psm/api-v1/
- Updated daily with official plant protection product data

### Bio/Organic Product Detection

The system uses a two-stage approach to identify organic products:

1. **Manual Flags** (`data/external/bio_flags.csv`): Manually curated list of certified organic products
2. **Heuristic Detection**: Pattern matching on product names (bio, öko, organic, naturalis)

Results are stored in `bvl_mittel_enrichments` table and exposed via the `bvl_mittel_extras` view.

### Static Lookup Data

- **GHS Hazard Statements** (`data/static/ghs_gefahrenhinweise.csv`): Standard GHS classification
- **Active Substances**: Supplementary substance information
- **Distributors**: Manufacturer contact information and websites

## API Endpoints

The pipeline fetches from these BVL API endpoints:

1. `stand` - API status and data date
2. `mittel` - Plant protection products
3. `awg` - Application areas
4. `awg_kultur` - Application cultures
5. `awg_schadorg` - Pest organisms
6. `awg_aufwand` - Application rates
7. `awg_wartezeit` - Waiting periods
8. `wirkstoff` - Active substances
9. `mittel_wirkstoff` - Product active substance content
10. `mittel_vertrieb` - Product distributors

## Configuration

### Endpoints Configuration (`configs/endpoints.yaml`)

```yaml
base_url: "https://psm-api.bvl.bund.de/ords/psm/api-v1/"
endpoints:
  - name: "mittel"
    path: "mittel"  # No leading slash!
    table: "bvl_mittel"
    primary_key: "kennr"
```

**Important**: Paths must be relative without leading slash to avoid URL construction issues.

### Enrichments Configuration (`configs/enrichments.yaml`)

```yaml
bio_flags:
  file: "data/external/bio_flags.csv"
bio_heuristics:
  enabled: true
  name_patterns: ["bio", "öko", "organic"]
```

## CI/CD Pipeline

### GitHub Actions Workflow

The pipeline runs:
- **Daily at 3 AM UTC** (scheduled)
- **On push to main branch**
- **Manually via workflow_dispatch**

### Workflow Steps

1. Lint and test code
2. Fetch data from BVL API
3. Validate database export
4. Generate checksums
5. Upload artifacts
6. Deploy to GitHub Pages

### Published Artifacts

Available at: `https://abbas-hoseiny.github.io/pflanzenschutz-db/`

- `pflanzenschutz.sqlite` - Full database
- `pflanzenschutz.sqlite.br` - Brotli compressed
- `pflanzenschutz.sqlite.zip` - ZIP compressed
- `manifest.json` - Metadata and file hashes

## Development

### Running Tests

```bash
# Run all tests
pytest scripts/tests/ -v

# Run specific test file
pytest scripts/tests/test_http_client.py -v

# Run with coverage
pytest scripts/tests/ --cov=scripts/helpers --cov-report=html
```

### Adding New Endpoints

1. Add endpoint to `configs/endpoints.yaml`
2. Create mapper in `scripts/helpers/transformers.py`
3. Update schema in `utils/sqlite_schema.sql`
4. Add tests

### Local Testing

```bash
# Test with skip-raw to avoid API calls
python scripts/fetch_bvl_data.py --output-dir data/output --skip-raw

# Test specific endpoint
# (modify script to comment out other endpoints)
```

## Troubleshooting

### Common Issues

**Empty Database Tables**
- Check that endpoint paths don't have leading slashes
- Verify API is accessible: `curl https://psm-api.bvl.bund.de/ords/psm/api-v1/stand`
- Check logs for HTTP errors

**Missing Enrichment Data**
- Ensure CSV files exist in `data/external/`
- Check CSV format (headers must match columns)
- Verify heuristic patterns in config

**Build Failures**
- Check GitHub Actions logs
- Validate schema matches API response structure
- Ensure all required tables are populated

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Data Attribution

Plant protection product data is provided by:
- Bundesamt für Verbraucherschutz und Lebensmittelsicherheit (BVL)
- https://www.bvl.bund.de/

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## Contact

For questions or issues, please open an issue on GitHub.
