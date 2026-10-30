-- Show @username in the Inbox instead of the raw Instagram-scoped ID
ALTER TABLE "DmMessage" ADD COLUMN "username" TEXT;

-- Old private replies to commenters: the commenter's username is in the activity log
UPDATE "DmMessage" d
SET "username" = a."detail"->>'from'
FROM "ActivityLog" a
WHERE a."kind" = 'comment.private_reply'
  AND a."accountId" = d."accountId"
  AND a."detail"->>'dm' = d."text"
  AND a."detail"->>'from' IS NOT NULL
  AND d."username" IS NULL;
