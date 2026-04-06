-- AlterTable
ALTER TABLE `CleaningTask`
    ADD COLUMN `assignedByEmail` VARCHAR(191) NULL,
    ADD COLUMN `assignedByName` VARCHAR(191) NULL;
