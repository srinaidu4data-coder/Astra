"""CLI tool for license key management.

Usage:
    python -m backend.license_cli generate --count 5
    python -m backend.license_cli list
    python -m backend.license_cli list --status active
    python -m backend.license_cli activate <key>
    python -m backend.license_cli deactivate <key>
    python -m backend.license_cli revoke <key>
"""

import argparse
import sys
import uuid
from datetime import datetime

from sqlmodel import Session, select

from backend.database import create_db_and_tables, engine
from backend.models import LicenseKey


def cmd_generate(args):
    """Generate N UUID v4 license keys."""
    create_db_and_tables()

    keys = []
    with Session(engine) as session:
        for _ in range(args.count):
            key = str(uuid.uuid4())
            license_key = LicenseKey(
                key=key,
                tier=args.tier,
                email=args.email,
                status="unused",
            )
            session.add(license_key)
            keys.append(key)
        session.commit()

    print(f"Generated {args.count} license key(s):\n")
    for key in keys:
        print(f"  {key}")
    print()


def cmd_list(args):
    """List all license keys."""
    create_db_and_tables()

    with Session(engine) as session:
        statement = select(LicenseKey)
        if args.status:
            statement = statement.where(LicenseKey.status == args.status)
        results = session.exec(statement).all()

    if not results:
        print("No license keys found.")
        return

    # Table header
    print(f"{'Key':<14} {'Status':<10} {'Tier':<10} {'Email':<25} {'Activated':<20} {'Hardware ID':<14}")
    print("-" * 93)

    for k in results:
        key_display = k.key[:8] + "..."
        activated = k.activated_at.strftime("%Y-%m-%d %H:%M") if k.activated_at else "-"
        hw_display = (k.hardware_id[:10] + "...") if k.hardware_id else "-"
        email_display = k.email or "-"

        print(f"{key_display:<14} {k.status:<10} {k.tier:<10} {email_display:<25} {activated:<20} {hw_display:<14}")

    print(f"\nTotal: {len(results)} key(s)")


def cmd_activate(args):
    """Activate a license key (admin override, no hardware_id required)."""
    create_db_and_tables()

    with Session(engine) as session:
        statement = select(LicenseKey).where(LicenseKey.key == args.key)
        db_key = session.exec(statement).first()

        if db_key is None:
            print(f"Error: Key not found: {args.key}")
            sys.exit(1)

        if db_key.status == "revoked":
            print(f"Error: Key is revoked and cannot be activated: {args.key}")
            sys.exit(1)

        db_key.status = "active"
        db_key.activated_at = datetime.utcnow()
        session.add(db_key)
        session.commit()

    print(f"Activated: {args.key}")


def cmd_deactivate(args):
    """Deactivate a license key, clearing hardware binding."""
    create_db_and_tables()

    with Session(engine) as session:
        statement = select(LicenseKey).where(LicenseKey.key == args.key)
        db_key = session.exec(statement).first()

        if db_key is None:
            print(f"Error: Key not found: {args.key}")
            sys.exit(1)

        db_key.status = "unused"
        db_key.hardware_id = None
        session.add(db_key)
        session.commit()

    print(f"Deactivated: {args.key}")


def cmd_revoke(args):
    """Revoke a license key permanently."""
    create_db_and_tables()

    with Session(engine) as session:
        statement = select(LicenseKey).where(LicenseKey.key == args.key)
        db_key = session.exec(statement).first()

        if db_key is None:
            print(f"Error: Key not found: {args.key}")
            sys.exit(1)

        if db_key.status == "revoked":
            print(f"Key is already revoked: {args.key}")
            return

        db_key.status = "revoked"
        session.add(db_key)
        session.commit()

    print(f"Revoked: {args.key}")


def main():
    parser = argparse.ArgumentParser(
        description="Astra License Key Management CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # generate
    gen_parser = subparsers.add_parser("generate", help="Generate new license keys")
    gen_parser.add_argument("--count", type=int, default=1, help="Number of keys to generate (default: 1)")
    gen_parser.add_argument("--tier", choices=["standard", "premium"], default="standard", help="License tier")
    gen_parser.add_argument("--email", type=str, default=None, help="Customer email")
    gen_parser.set_defaults(func=cmd_generate)

    # list
    list_parser = subparsers.add_parser("list", help="List license keys")
    list_parser.add_argument("--status", choices=["unused", "active", "revoked"], default=None, help="Filter by status")
    list_parser.set_defaults(func=cmd_list)

    # activate
    act_parser = subparsers.add_parser("activate", help="Activate a license key (admin)")
    act_parser.add_argument("key", help="License key to activate")
    act_parser.set_defaults(func=cmd_activate)

    # deactivate
    deact_parser = subparsers.add_parser("deactivate", help="Deactivate a license key")
    deact_parser.add_argument("key", help="License key to deactivate")
    deact_parser.set_defaults(func=cmd_deactivate)

    # revoke
    rev_parser = subparsers.add_parser("revoke", help="Revoke a license key permanently")
    rev_parser.add_argument("key", help="License key to revoke")
    rev_parser.set_defaults(func=cmd_revoke)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
