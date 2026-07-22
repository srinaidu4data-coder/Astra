#!/usr/bin/env python3
"""
Document ingestion script for Astra MVP.
Reads documents from a folder, chunks them, embeds with OpenAI, and stores in ChromaDB.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from collections.abc import Callable

import chromadb
import pdfplumber
from openai import OpenAI

from config import LICENSE_ENABLED, get_license_key, get_openai_api_key, get_proxy_url

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
COLLECTION_NAME = "astra_docs"
EMBEDDING_MODEL = "text-embedding-3-small"

# Cross-platform path for ChromaDB
# Keep DB path in sync with rag.py (user_data_dir when available)
try:
    from rag import CHROMA_DB_PATH
except Exception:
    CHROMA_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_db")


def read_txt_file(file_path: Path) -> str:
    """Read content from a .txt or .md file."""
    with open(file_path, "r", encoding="utf-8") as f:
        return f.read()


def clean_pdf_text(text: str) -> str:
    """Clean and normalize extracted PDF text while preserving structure."""
    import re

    # Normalize whitespace but preserve newlines for structure
    lines = text.split('\n')
    cleaned_lines = []

    for line in lines:
        # Strip trailing whitespace but preserve leading (for indentation)
        line = line.rstrip()

        # Skip completely empty lines (but keep one for paragraph breaks)
        if not line:
            if cleaned_lines and cleaned_lines[-1] != '':
                cleaned_lines.append('')
            continue

        # Preserve bullet points and list markers
        # Common patterns: •, -, *, ▪, ●, ○, numbers with . or )
        bullet_pattern = r'^(\s*)([-•▪●○\*]|\d+[.\)])\s*'
        match = re.match(bullet_pattern, line)
        if match:
            # Ensure bullet points are properly formatted
            indent = match.group(1)
            marker = match.group(2)
            rest = line[match.end():]
            line = f"{indent}• {rest}"

        cleaned_lines.append(line)

    # Join and clean up multiple blank lines
    text = '\n'.join(cleaned_lines)
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


def read_pdf_file(file_path: Path) -> str:
    """
    Read content from a PDF file using pdfplumber.

    Features:
    - Handles multi-page documents
    - Skips empty pages
    - Preserves structure (headers, bullet points)
    - Extracts text with layout awareness
    """
    text_parts = []

    with pdfplumber.open(file_path) as pdf:
        total_pages = len(pdf.pages)

        for page_num, page in enumerate(pdf.pages, 1):
            # Extract text with layout preservation
            page_text = page.extract_text(
                layout=True,
                x_density=7.25,
                y_density=13
            )

            # Skip empty pages
            if not page_text or not page_text.strip():
                continue

            # Clean the extracted text
            cleaned_text = clean_pdf_text(page_text)

            if cleaned_text:
                # Add page marker for multi-page docs (helps with context)
                if total_pages > 1:
                    text_parts.append(f"[Page {page_num}]\n{cleaned_text}")
                else:
                    text_parts.append(cleaned_text)

    return "\n\n".join(text_parts)


def read_file(file_path: Path) -> str:
    """Read content from a file based on its extension."""
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        return read_pdf_file(file_path)
    elif suffix in (".txt", ".md"):
        return read_txt_file(file_path)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks."""
    if not text:
        return []

    chunks = []
    start = 0
    text_length = len(text)

    while start < text_length:
        end = start + chunk_size
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk)
        start = end - overlap

    return chunks


def get_embeddings(client: OpenAI, texts: list[str], batch_size: int = 1000) -> list[list[float]]:
    """
    Get embeddings for a list of texts using OpenAI API.

    Batches requests to stay under OpenAI's 300k tokens per request limit.
    With ~500 char chunks (~125 tokens each), 1000 chunks ≈ 125k tokens (safe margin).
    """
    all_embeddings = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=batch
        )
        all_embeddings.extend([item.embedding for item in response.data])

    return all_embeddings


def get_doc_type(file_path: Path) -> str:
    """Get document type from file extension."""
    suffix = file_path.suffix.lower()
    return {
        ".txt": "text",
        ".md": "markdown",
        ".pdf": "pdf"
    }.get(suffix, "unknown")


def ingest_folder_with_progress(
    folder_path: str,
    progress_callback: Callable[[dict], None] | None = None
) -> dict:
    """
    Ingest all supported documents from a folder into ChromaDB with progress reporting.

    Args:
        folder_path: Path to folder containing documents
        progress_callback: Optional callback receiving progress dicts with:
            - stage: "scanning" | "processing" | "complete" | "error"
            - total_files: int
            - current_file_index: int (0-based)
            - current_file_name: str
            - current_file_chunks: int
            - total_chunks: int (cumulative)
            - message: str (human-readable status)

    Returns:
        dict with success, total_files, total_chunks, errors
    """
    folder = Path(folder_path)
    errors: list[str] = []

    def report(stage: str, **kwargs):
        """Helper to call progress callback if provided."""
        if progress_callback:
            progress_callback({"stage": stage, **kwargs})

    # Validate folder
    if not folder.exists():
        msg = f"Folder '{folder_path}' does not exist."
        report("error", message=msg, total_files=0, current_file_index=0,
               current_file_name="", current_file_chunks=0, total_chunks=0)
        return {"success": False, "total_files": 0, "total_chunks": 0, "errors": [msg]}

    if not folder.is_dir():
        msg = f"'{folder_path}' is not a directory."
        report("error", message=msg, total_files=0, current_file_index=0,
               current_file_name="", current_file_chunks=0, total_chunks=0)
        return {"success": False, "total_files": 0, "total_chunks": 0, "errors": [msg]}

    # Find all supported files
    supported_extensions = {".txt", ".md", ".pdf"}
    files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in supported_extensions]

    total_files = len(files)

    if not files:
        msg = f"No supported files (.txt, .md, .pdf) found in '{folder_path}'."
        report("scanning", message=msg, total_files=0, current_file_index=0,
               current_file_name="", current_file_chunks=0, total_chunks=0)
        if not progress_callback:
            print(msg)
        return {"success": True, "total_files": 0, "total_chunks": 0, "errors": []}

    # Report scanning complete
    report("scanning", message=f"Found {total_files} file(s) to process",
           total_files=total_files, current_file_index=0,
           current_file_name="", current_file_chunks=0, total_chunks=0)
    if not progress_callback:
        print(f"Found {total_files} file(s) to process.")

    # OpenAI client — direct key when licensing is off; proxy+license when on
    if not LICENSE_ENABLED:
        api_key = get_openai_api_key()
        if not api_key:
            msg = "OpenAI API key not found. Set OPENAI_API_KEY in .env"
            report("error", message=msg, total_files=total_files, current_file_index=0,
                   current_file_name="", current_file_chunks=0, total_chunks=0)
            return {"success": False, "total_files": total_files, "total_chunks": 0, "errors": [msg]}
        openai_client = OpenAI(api_key=api_key)
    else:
        license_key = get_license_key()
        if not license_key:
            msg = "License key not configured. Activate your license in the app."
            report("error", message=msg, total_files=total_files, current_file_index=0,
                   current_file_name="", current_file_chunks=0, total_chunks=0)
            return {"success": False, "total_files": total_files, "total_chunks": 0, "errors": [msg]}
        proxy_url = get_proxy_url()
        openai_client = OpenAI(api_key=license_key, base_url=proxy_url)

    # Initialize ChromaDB
    chroma_client = chromadb.PersistentClient(path=CHROMA_DB_PATH)

    # Get or create collection
    collection = chroma_client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"}
    )

    total_chunks = 0

    for idx, file_path in enumerate(files):
        # Report processing start for this file
        report("processing", message=f"Processing {file_path.name}",
               total_files=total_files, current_file_index=idx,
               current_file_name=file_path.name, current_file_chunks=0,
               total_chunks=total_chunks)
        if not progress_callback:
            print(f"\nProcessing: {file_path.name}")

        try:
            # Read file content
            content = read_file(file_path)
            if not content.strip():
                if not progress_callback:
                    print(f"  Skipping: Empty file")
                continue

            # Chunk the content
            chunks = chunk_text(content)
            file_chunks = len(chunks)
            if not progress_callback:
                print(f"  Created {file_chunks} chunk(s)")

            if not chunks:
                continue

            # Get embeddings (batched for large documents)
            if not progress_callback:
                if file_chunks > 1000:
                    print(f"  Generating embeddings ({file_chunks} chunks, this may take a moment)...")
                else:
                    print(f"  Generating embeddings...")
            embeddings = get_embeddings(openai_client, chunks)

            # Prepare data for ChromaDB
            doc_type = get_doc_type(file_path)
            ids = [f"{file_path.stem}_{i}" for i in range(len(chunks))]
            metadatas = [
                {
                    "source_file": file_path.name,
                    "chunk_index": i,
                    "doc_type": doc_type
                }
                for i in range(len(chunks))
            ]

            # Upsert to collection (handles re-uploaded documents)
            collection.upsert(
                ids=ids,
                embeddings=embeddings,
                documents=chunks,
                metadatas=metadatas
            )

            total_chunks += file_chunks
            if not progress_callback:
                print(f"  Added to collection: {COLLECTION_NAME}")

        except Exception as e:
            error_msg = f"Error processing {file_path.name}: {e}"
            errors.append(error_msg)
            if not progress_callback:
                print(f"  {error_msg}")
            continue

    # Invalidate BM25 cache so hybrid search rebuilds index with new documents
    try:
        from rag import invalidate_bm25_cache
        invalidate_bm25_cache()
    except ImportError:
        pass  # rag module not available, skip

    # Report completion
    report("complete", message=f"Ingestion complete! {total_chunks} chunks added.",
           total_files=total_files, current_file_index=total_files - 1,
           current_file_name="", current_file_chunks=0, total_chunks=total_chunks)
    if not progress_callback:
        print(f"\nIngestion complete!")
        print(f"Total chunks added: {total_chunks}")
        print(f"Collection: {COLLECTION_NAME}")

    return {
        "success": len(errors) == 0,
        "total_files": total_files,
        "total_chunks": total_chunks,
        "errors": errors
    }


def ingest_folder(folder_path: str) -> None:
    """Ingest all supported documents from a folder into ChromaDB."""
    result = ingest_folder_with_progress(folder_path, progress_callback=None)
    if not result["success"] and result["errors"]:
        # Original function would exit on folder errors
        first_error = result["errors"][0]
        if "does not exist" in first_error or "is not a directory" in first_error:
            print(f"Error: {first_error}")
            sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Ingest documents into ChromaDB with OpenAI embeddings."
    )
    parser.add_argument(
        "folder",
        type=str,
        help="Path to folder containing .txt, .pdf, or .md files"
    )

    args = parser.parse_args()
    ingest_folder(args.folder)


if __name__ == "__main__":
    main()
