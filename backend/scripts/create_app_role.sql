-- Least-privilege database role for the API (#3302). Runbook: docs/RENDER.md,
-- "App database role".
--
-- Run the whole file as the MIGRATION role: the role Alembic connects as, which
-- owns the tables (Supabase: `postgres`; Render dev: the database's own user).
-- That role becomes the one whose future tables the app role is granted
-- (ALTER DEFAULT PRIVILEGES FOR ROLE current_user). Run it in the app's
-- database, e.g. the Supabase SQL editor, or
--   psql "$MIGRATION_DATABASE_URL" -f backend/scripts/create_app_role.sql
--
-- What the app role gets: LOGIN, CONNECT on this database, USAGE on schema
-- public, SELECT/INSERT/UPDATE/DELETE on every table in it, and USAGE/SELECT on
-- its sequences (an INSERT into a serial column calls nextval), now and for every
-- table or sequence the migration role creates later. It gets nothing else: no
-- CREATE on the schema (no DDL), no TRUNCATE, REFERENCES or TRIGGER, and only
-- SELECT on alembic_version. It owns nothing, so it cannot ALTER or DROP a table.
-- A role-level statement_timeout (5 s, the DB_STATEMENT_TIMEOUT_SECONDS default)
-- backs up the one the API sends when it connects.
--
-- No password is set here, and none may be committed: a LOGIN role without one
-- cannot sign in with password auth. Set it afterwards, outside this file, with
-- psql's \password bc_app (prompts, sends only a hash) or, in the Supabase SQL
-- editor, ALTER ROLE bc_app WITH PASSWORD '...'.
--
-- Idempotent: running it again re-applies the grants and revokes, changes
-- nothing else, and never touches the password. It runs as one DO block, so it
-- applies completely or not at all.
--
-- The role name defaults to bc_app. To use another, set it on the same session
-- first: SET bc_arcade.app_role = 'other_name';  (tests do this).

DO $script$
DECLARE
    app_role text := coalesce(nullif(current_setting('bc_arcade.app_role', true), ''), 'bc_app');
    migration_role text := current_user;
    db text := current_database();
BEGIN
    IF app_role = migration_role THEN
        RAISE EXCEPTION 'run this as the migration role, not as the app role %', app_role;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
        EXECUTE format(
            'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
            app_role
        );
    ELSE
        -- Changing these attributes needs superuser, which Supabase's `postgres`
        -- is not, so an existing role is checked rather than altered.
        IF EXISTS (
            SELECT 1 FROM pg_roles
            WHERE rolname = app_role
              AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
        ) THEN
            RAISE EXCEPTION
                'role % already exists with SUPERUSER, CREATEDB, CREATEROLE, REPLICATION or '
                'BYPASSRLS; drop it or pick another name (SET bc_arcade.app_role)', app_role;
        END IF;
        EXECUTE format('ALTER ROLE %I LOGIN', app_role);
    END IF;
    EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', app_role, '5s');

    -- PUBLIC holds CONNECT by default; grant it only where it has been revoked.
    IF NOT has_database_privilege(app_role, db, 'CONNECT') THEN
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', db, app_role);
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
    EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', app_role);

    -- Tables and sequences that exist now.
    EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role
    );
    EXECUTE format(
        'REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM %I', app_role
    );
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);
    EXECUTE format('REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM %I', app_role);
    IF to_regclass('public.alembic_version') IS NOT NULL THEN
        EXECUTE format(
            'REVOKE INSERT, UPDATE, DELETE ON public.alembic_version FROM %I', app_role
        );
    END IF;

    -- Tables and sequences later migrations create (as the migration role).
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
        migration_role, app_role
    );
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM %I',
        migration_role, app_role
    );
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'GRANT USAGE, SELECT ON SEQUENCES TO %I',
        migration_role, app_role
    );

    -- Anything granted to PUBLIC is the app role's too. Postgres 15+ no longer
    -- grants CREATE on schema public to PUBLIC, but an upgraded or provider-built
    -- database may still. Revoking it from PUBLIC affects every role, so this
    -- stops (and applies nothing) rather than doing it silently.
    IF has_schema_privilege(app_role, 'public', 'CREATE') THEN
        RAISE EXCEPTION
            'role % can still CREATE in schema public (granted to PUBLIC or a role it is a member of). '
            'Confirm % keeps its own CREATE on the schema (it owns it, or has an explicit grant), '
            'then run REVOKE CREATE ON SCHEMA public FROM PUBLIC; and run this file again.',
            app_role, migration_role;
    END IF;
END
$script$;
