-- Copy the published demo Space's original public records into the demo archive,
-- so its public Space and agent pages keep their name, ENS labels and activity
-- after an app reset. Run against the archive with the pre-reset backup attached
-- as `source`; see docs/deployment.md. Existing archive rows are never replaced.
BEGIN;
INSERT OR IGNORE INTO space_drafts SELECT * FROM source.space_drafts
  WHERE lower(space_address) = lower('0x7ba799558ce5B5Dd0bA260aE47f6106de359ad0F') AND activated_at IS NOT NULL;
INSERT OR IGNORE INTO space_namespaces SELECT * FROM source.space_namespaces
  WHERE lower(space_address) = lower('0x7ba799558ce5B5Dd0bA260aE47f6106de359ad0F');
INSERT OR IGNORE INTO allocation_names SELECT * FROM source.allocation_names
  WHERE lower(space_address) = lower('0x7ba799558ce5B5Dd0bA260aE47f6106de359ad0F');
INSERT OR IGNORE INTO agent_policies SELECT * FROM source.agent_policies
  WHERE lower(space_address) = lower('0x7ba799558ce5B5Dd0bA260aE47f6106de359ad0F');
COMMIT;
