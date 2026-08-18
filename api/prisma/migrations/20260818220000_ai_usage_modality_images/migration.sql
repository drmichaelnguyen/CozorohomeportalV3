-- AlterTable
ALTER TABLE `AiUsageEvent` ADD COLUMN `modality` VARCHAR(191) NOT NULL DEFAULT 'text',
    ADD COLUMN `imageCount` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `AiUsageEvent_modality_createdAt_idx` ON `AiUsageEvent`(`modality`, `createdAt`);
