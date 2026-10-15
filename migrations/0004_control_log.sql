-- phase: expand
-- ADR-048 amendment 2026-10-15 (server/registry/resource-control.js): the first answer to each control request
-- OpenVibe.Services sent for a person's restream definition, per (caller, idempotency_key), so a retry is never
-- applied twice. Never edited after it runs; a further change is a new migration.
CREATE TABLE openre_control_log (
    caller          text COLLATE "C" NOT NULL,                    -- the service that asked (svc:services)
    idempotency_key text COLLATE "C" NOT NULL,
    owner_subject   text COLLATE "C" NOT NULL,                    -- the definition's owner the request named
    digest          text COLLATE "C" NOT NULL,                    -- the request without its delivery fields
    response        text NOT NULL,
    created_at      bigint NOT NULL,
    PRIMARY KEY (caller, idempotency_key)
);
