-- Existing rules: empty list instead of NULL
UPDATE "AutomationRule" SET "quickReplies" = '{}' WHERE "quickReplies" IS NULL;
