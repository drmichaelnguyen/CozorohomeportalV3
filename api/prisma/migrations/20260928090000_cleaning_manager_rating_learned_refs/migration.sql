-- AlterTable
ALTER TABLE `CleaningTask` ADD COLUMN `managerRating` INTEGER NULL;

-- AlterTable
ALTER TABLE `CleaningAudit` ADD COLUMN `qualityRating` INTEGER NULL;

-- AlterTable
ALTER TABLE `CleaningCompletionPhoto` ADD COLUMN `excludedFromReference` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `CleaningTask_type_branchId_status_managerRating_idx` ON `CleaningTask`(`type`, `branchId`, `status`, `managerRating`);
