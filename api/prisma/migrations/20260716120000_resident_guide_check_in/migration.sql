-- AlterTable ResidentGuideSection: add check-in category + audience targeting
ALTER TABLE `ResidentGuideSection`
  ADD COLUMN `category` ENUM('HOWTO', 'CHECK_IN') NOT NULL DEFAULT 'HOWTO',
  ADD COLUMN `audience` ENUM('LONG_TERM', 'SHORT_TERM', 'BOTH') NOT NULL DEFAULT 'BOTH';

CREATE INDEX `ResidentGuideSection_category_audience_idx` ON `ResidentGuideSection`(`category`, `audience`);
