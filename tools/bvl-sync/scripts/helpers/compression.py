"""
Compression utilities for database files.
"""

import brotli
import gzip
import zipfile
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def compress_brotli(input_file: str, output_file: str = None, quality: int = 11) -> str:
    """
    Compress file using Brotli.
    
    Args:
        input_file: Path to input file
        output_file: Path to output file (default: input_file + .br)
        quality: Brotli compression quality (0-11, default 11)
        
    Returns:
        Path to compressed file
    """
    if output_file is None:
        output_file = input_file + '.br'
        
    logger.info(f"Compressing {input_file} to {output_file} with Brotli (quality={quality})")
    
    with open(input_file, 'rb') as f_in:
        data = f_in.read()
        
    compressed = brotli.compress(data, quality=quality)
    
    with open(output_file, 'wb') as f_out:
        f_out.write(compressed)
        
    original_size = len(data)
    compressed_size = len(compressed)
    ratio = (1 - compressed_size / original_size) * 100
    
    logger.info(f"Brotli compression: {original_size:,} -> {compressed_size:,} bytes ({ratio:.1f}% reduction)")
    
    return output_file


def compress_zip(input_file: str, output_file: str = None) -> str:
    """
    Compress file using ZIP.
    
    Args:
        input_file: Path to input file
        output_file: Path to output file (default: input_file + .zip)
        
    Returns:
        Path to compressed file
    """
    if output_file is None:
        output_file = input_file + '.zip'
        
    logger.info(f"Compressing {input_file} to {output_file} with ZIP")
    
    input_path = Path(input_file)
    
    with zipfile.ZipFile(output_file, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        zf.write(input_file, input_path.name)
        
    original_size = input_path.stat().st_size
    compressed_size = Path(output_file).stat().st_size
    ratio = (1 - compressed_size / original_size) * 100
    
    logger.info(f"ZIP compression: {original_size:,} -> {compressed_size:,} bytes ({ratio:.1f}% reduction)")
    
    return output_file


def compress_database(db_path: str, output_dir: str = None) -> dict:
    """
    Compress database with both Brotli and ZIP.
    
    Args:
        db_path: Path to database file
        output_dir: Output directory (default: same as db_path)
        
    Returns:
        Dictionary with compression results
    """
    db_path_obj = Path(db_path)
    
    if output_dir is None:
        output_dir = str(db_path_obj.parent)
        
    results = {
        'original': str(db_path),
        'original_size': db_path_obj.stat().st_size
    }
    
    # Brotli compression
    try:
        brotli_file = compress_brotli(db_path, f"{output_dir}/{db_path_obj.name}.br")
        results['brotli'] = brotli_file
        results['brotli_size'] = Path(brotli_file).stat().st_size
    except Exception as e:
        logger.error(f"Brotli compression failed: {e}")
        
    # ZIP compression
    try:
        zip_file = compress_zip(db_path, f"{output_dir}/{db_path_obj.name}.zip")
        results['zip'] = zip_file
        results['zip_size'] = Path(zip_file).stat().st_size
    except Exception as e:
        logger.error(f"ZIP compression failed: {e}")
        
    return results
