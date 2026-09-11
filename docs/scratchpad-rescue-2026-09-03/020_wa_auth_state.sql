CREATE TABLE IF NOT EXISTS wa_auth_state (
    session_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    blob TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_auth_state_tenant_id
    ON wa_auth_state (tenant_id);

COMMENT ON TABLE wa_auth_state IS
    'Stores encrypted Baileys authentication state as a single blob per session, replacing the file-based storage system.';

COMMENT ON COLUMN wa_auth_state.blob IS
    'Encrypted-at-rest Baileys auth state. Must never be written in plaintext. Replaces a file-per-key layout in which 6,587 of 6,588 files were unencrypted.';
