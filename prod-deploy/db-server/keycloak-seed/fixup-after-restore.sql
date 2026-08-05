-- ===========================================================================
-- Keycloak seed - STEP 2: point the restored realm at this server
-- ===========================================================================
-- Run in DBeaver against the `keycloak` database, right after keycloak-seed.sql.
--
-- The seed is a copy of the development Keycloak, so every client URL in it
-- still says http://localhost. Until this runs, logging in fails with
-- "Invalid parameter: redirect_uri" - Keycloak refuses to send the browser back
-- to an address the client is not registered for.
--
-- KEYCLOAK MUST BE STOPPED while this runs.
-- Realm and client data are cached in memory (Infinispan); editing the database
-- underneath a running Keycloak leaves it serving the OLD values, with nothing
-- logged to say why.
--
--     on the APP server:   docker compose stop keycloak
--     ... run this file ...
--     on the APP server:   docker compose start keycloak
--
-- Safe to re-run, but it can only run ONCE MEANINGFULLY: it finds work by
-- looking for "localhost", so once the URLs have been rewritten there is
-- nothing left for it to match. Re-running it with a DIFFERENT address does
-- NOT re-target the realm - it reports 0 rows changed and silently leaves the
-- old address in place.
--
-- To change the address later, pick one:
--   * restore keycloak-seed.sql again, then run this file with the new value
--   * or edit the two fields in the Keycloak admin console:
--       Clients -> testing-web -> Valid redirect URIs / Web origins
--     and update APP_PUBLIC_URL in the app server's .env to match.
-- ===========================================================================


-- ###########################################################################
--  EDIT THE ONE LINE MARKED <<<< THEN RUN THE WHOLE FILE
-- ###########################################################################
DO $fixup$
DECLARE
    -- The address users type in their browser. NO trailing slash.
    -- Must be identical to APP_PUBLIC_URL in the app server's .env file.
    v_app_url text := 'http://10.0.0.50';                      -- <<<< EDIT THIS

    -- Remove the development accounts?
    --
    -- Left FALSE on purpose. These accounts ARE the seeded logins - `admin`,
    -- `dev-manager` and `manager1` each hold the manager role, and deleting them
    -- leaves NOBODY able to sign in to the application. You would then have to
    -- create a user by hand in the Keycloak console.
    --
    -- They carry their DEVELOPMENT PASSWORDS. Treat that as a temporary state:
    -- sign in, then change every password from the app's "ניהול משתמשים" page,
    -- and delete the accounts you do not need. Once a real manager account
    -- exists, you can set this to TRUE and re-run to remove the rest.
    v_delete_dev_users boolean := false;
    v_dev_users        text[]  := ARRAY['manager1', 'bodek1', 'mahsan1', 'dev-manager'];

    -- The PostgreSQL login role Keycloak connects with. Matches
    -- KEYCLOAK_DB_USER in the DB server's .env and KC_DB_USERNAME on the app
    -- server. Only change it if you renamed that role.
    v_db_role text := 'keycloak';

    v_realm    text := 'testing';
    v_realm_id text;
    v_user_ids text[];
    v_obj      record;
    v_n        int;
BEGIN
    SELECT id INTO v_realm_id FROM realm WHERE name = v_realm;
    IF v_realm_id IS NULL THEN
        RAISE EXCEPTION 'Realm "%" not found - was keycloak-seed.sql restored into this database first?', v_realm;
    END IF;
    IF v_app_url LIKE '%/' THEN
        RAISE EXCEPTION 'v_app_url must not end with a slash (got "%")', v_app_url;
    END IF;
    IF v_app_url NOT LIKE 'http://%' AND v_app_url NOT LIKE 'https://%' THEN
        RAISE EXCEPTION 'v_app_url must start with http:// or https:// (got "%")', v_app_url;
    END IF;

    -- -----------------------------------------------------------------------
    -- 0. Hand every restored object to the `keycloak` role
    -- -----------------------------------------------------------------------
    -- You almost certainly ran the seed in DBeaver as the ADMIN/superuser, which
    -- makes that user the OWNER of all 100 restored tables. Keycloak connects as
    -- the `keycloak` role, and would fail to start with:
    --
    --     ERROR: permission denied for table databasechangelog
    --
    -- printed before it has done anything else. Re-owning the objects here means
    -- it does not matter which account performed the restore.
    FOR v_obj IN
        SELECT 'TABLE'    AS kind, tablename    AS name FROM pg_tables    WHERE schemaname = 'public'
        UNION ALL
        SELECT 'SEQUENCE',        sequencename        FROM pg_sequences  WHERE schemaname = 'public'
        UNION ALL
        SELECT 'VIEW',            viewname            FROM pg_views      WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER %s public.%I OWNER TO %I', v_obj.kind, v_obj.name, v_db_role);
    END LOOP;
    EXECUTE format('GRANT ALL ON SCHEMA public TO %I', v_db_role);
    RAISE NOTICE 'objects re-owned to role "%"', v_db_role;

    -- -----------------------------------------------------------------------
    -- 1. Rewrite every development URL to this server
    -- -----------------------------------------------------------------------
    -- The dev realm registers BOTH http://localhost:3000/* and http://localhost/*
    -- for the login client. Two things follow, and both have bitten this script:
    --
    --   a) Order matters. Replace the port-bearing form FIRST, or the shorter
    --      pattern matches first and leaves a stray ":3000" glued to the new URL.
    --   b) Both rows COLLAPSE to the same value once the host is the same, which
    --      violates the unique constraint on (client_id, value). So this cannot
    --      be a plain UPDATE - it inserts the de-duplicated results and then
    --      drops the originals.
    INSERT INTO redirect_uris (client_id, value)
    SELECT DISTINCT client_id,
           replace(replace(value, 'http://localhost:3000', v_app_url),
                   'http://localhost', v_app_url)
      FROM redirect_uris
     WHERE value LIKE '%localhost%'
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;  RAISE NOTICE 'redirect_uris added: %', v_n;
    DELETE FROM redirect_uris WHERE value LIKE '%localhost%';

    INSERT INTO web_origins (client_id, value)
    SELECT DISTINCT client_id,
           replace(replace(value, 'http://localhost:3000', v_app_url),
                   'http://localhost', v_app_url)
      FROM web_origins
     WHERE value LIKE '%localhost%'
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;  RAISE NOTICE 'web_origins added: %', v_n;
    DELETE FROM web_origins WHERE value LIKE '%localhost%';

    -- post.logout.redirect.uris and similar live here as ##-separated LISTS in a
    -- single row, so there is no unique constraint to trip - but the list itself
    -- would end up holding the same URL twice. Split, de-duplicate, re-join.
    UPDATE client_attributes ca
       SET value = sub.joined
      FROM (
        SELECT c.client_id, c.name,
               (SELECT string_agg(DISTINCT part, '##')
                  FROM unnest(string_to_array(
                         replace(replace(c.value, 'http://localhost:3000', v_app_url),
                                 'http://localhost', v_app_url), '##')) AS part
               ) AS joined
          FROM client_attributes c
         WHERE c.value LIKE '%localhost%'
      ) sub
     WHERE ca.client_id = sub.client_id AND ca.name = sub.name;
    GET DIAGNOSTICS v_n = ROW_COUNT;  RAISE NOTICE 'client_attributes rewritten: %', v_n;

    -- A realm-level frontend URL would override KC_HOSTNAME and silently send
    -- users back to localhost. The dev realm should not have one; make sure.
    DELETE FROM realm_attribute WHERE realm_id = v_realm_id AND name = 'frontendUrl';

    -- -----------------------------------------------------------------------
    -- 2. Drop development sessions
    -- -----------------------------------------------------------------------
    -- Sessions from the dev machine mean nothing here and would otherwise show
    -- up as phantom logged-in users.
    DELETE FROM offline_client_session
     WHERE user_session_id IN (SELECT user_session_id FROM offline_user_session WHERE realm_id = v_realm_id);
    DELETE FROM offline_user_session WHERE realm_id = v_realm_id;

    -- -----------------------------------------------------------------------
    -- 3. Optional: remove the development accounts
    -- -----------------------------------------------------------------------
    IF v_delete_dev_users THEN
        SELECT array_agg(id) INTO v_user_ids
          FROM user_entity WHERE realm_id = v_realm_id AND username = ANY(v_dev_users);

        IF v_user_ids IS NULL THEN
            RAISE NOTICE 'no development accounts left to delete';
        ELSE
            -- NINE tables reference user_entity, every one with NO ACTION rather
            -- than ON DELETE CASCADE, so a plain DELETE FROM user_entity fails on
            -- a foreign key. Children first, in this order.
            DELETE FROM user_role_mapping     WHERE user_id = ANY(v_user_ids);
            DELETE FROM user_group_membership WHERE user_id = ANY(v_user_ids);
            DELETE FROM user_required_action  WHERE user_id = ANY(v_user_ids);
            DELETE FROM user_attribute        WHERE user_id = ANY(v_user_ids);
            DELETE FROM credential            WHERE user_id = ANY(v_user_ids);
            DELETE FROM federated_identity    WHERE user_id = ANY(v_user_ids);
            DELETE FROM user_consent          WHERE user_id = ANY(v_user_ids);
            -- Present only on newer Keycloak versions; ignore if absent so this
            -- file also runs against an older seed.
            BEGIN DELETE FROM issued_ver_credential WHERE user_id = ANY(v_user_ids);
            EXCEPTION WHEN undefined_table THEN NULL; END;
            BEGIN DELETE FROM user_ver_credential   WHERE user_id = ANY(v_user_ids);
            EXCEPTION WHEN undefined_table THEN NULL; END;

            DELETE FROM user_entity WHERE id = ANY(v_user_ids);
            GET DIAGNOSTICS v_n = ROW_COUNT;  RAISE NOTICE 'development accounts deleted: %', v_n;
        END IF;
    ELSE
        RAISE NOTICE 'development accounts KEPT - change their passwords from the app after first login';
    END IF;

    RAISE NOTICE '--- fixup complete, target = % ---', v_app_url;
END
$fixup$;


-- ###########################################################################
--  VERIFY - read this output before starting Keycloak
-- ###########################################################################
-- "localhost left anywhere" must be 0. Anything else means a URL was missed and
-- login will fail with "Invalid parameter: redirect_uri".

SELECT 'client redirect uris' AS check, string_agg(DISTINCT value, ', ') AS value FROM redirect_uris
UNION ALL
SELECT 'client web origins',   string_agg(DISTINCT value, ', ') FROM web_origins
UNION ALL
SELECT 'localhost left anywhere',
       ((SELECT count(*) FROM redirect_uris      WHERE value LIKE '%localhost%')
      + (SELECT count(*) FROM web_origins        WHERE value LIKE '%localhost%')
      + (SELECT count(*) FROM client_attributes  WHERE value LIKE '%localhost%'))::text
UNION ALL
SELECT 'accounts that can sign in', string_agg(entry, ', ' ORDER BY entry)
  FROM (
    SELECT ue.username || ' (' || COALESCE(string_agg(kr.name, '+'), 'NO ROLE') || ')' AS entry
      FROM user_entity ue
      LEFT JOIN user_role_mapping urm ON urm.user_id = ue.id
      LEFT JOIN keycloak_role kr ON kr.id = urm.role_id
           AND kr.name IN ('manager', 'tester', 'storekeeper', 'mashan')
     WHERE ue.realm_id = (SELECT id FROM realm WHERE name = 'testing')
       AND ue.username NOT LIKE 'service-account-%'
     GROUP BY ue.username
  ) accounts;
