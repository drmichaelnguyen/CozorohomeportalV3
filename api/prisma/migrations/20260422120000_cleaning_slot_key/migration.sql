-- Add slotKey column for cross-process duplicate prevention
-- Format: "{type}|{YYYY-MM-DD}|{floor or empty}"
-- A unique index on this column means the DB rejects duplicate slots
-- regardless of how many app instances (dev + prod) are running.

ALTER TABLE `CleaningTask` ADD COLUMN `slotKey` VARCHAR(60) NOT NULL DEFAULT '';

-- Back-fill existing rows
UPDATE `CleaningTask`
SET `slotKey` = CONCAT(
  `type`, '|',
  DATE_FORMAT(`scheduledDate`, '%Y-%m-%d'), '|',
  IFNULL(`floor`, '')
);

-- Remove exact duplicate slotKeys before adding the unique constraint,
-- keeping the row with the earliest createdAt for each slot.
DELETE t1 FROM `CleaningTask` t1
INNER JOIN `CleaningTask` t2
  ON t1.`slotKey` = t2.`slotKey`
  AND t1.`createdAt` > t2.`createdAt`;

-- Now add the unique constraint
CREATE UNIQUE INDEX `CleaningTask_slotKey_key` ON `CleaningTask`(`slotKey`);
