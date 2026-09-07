-- Make historical activation consent effective by backfilling observation_consent
-- from granted observation rows in whatsapp_consent. The statement is idempotent:
-- existing tenant rows are left untouched by ON CONFLICT DO NOTHING.
INSERT INTO observation_consent (tenant_id, status)
SELECT DISTINCT tenant_id, 'granted'
FROM whatsapp_consent
WHERE scope = 'observation'
  AND status = 'granted'
ON CONFLICT (tenant_id) DO NOTHING;
