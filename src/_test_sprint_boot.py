"""Smoke: import Sprint modules + create tables."""
from backend.database import create_db_and_tables
from backend.products import product_catalog
from backend.sprint import router

create_db_and_tables()
assert len(product_catalog()) >= 4
assert any(r.path for r in router.routes)
print("ok", len(product_catalog()), "products,", len(router.routes), "sprint routes")
