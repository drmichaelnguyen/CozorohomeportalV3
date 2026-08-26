-- AlterTable
ALTER TABLE `CoinLedger` MODIFY `reason` ENUM('BOOKING_CHARGE', 'TOPUP', 'ADJUSTMENT', 'REFUND', 'CLEANING_REWARD', 'CLEANING_REVERSAL', 'CLEANING_SWAP_DEBIT', 'CLEANING_SWAP_CREDIT', 'REWARDED_CLEANING_REWARD', 'REWARDED_CLEANING_REVERSAL') NOT NULL;

-- CreateTable
CREATE TABLE `RewardedCleaningSite` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RewardedCleaningSite_branchId_isActive_idx`(`branchId`, `isActive`),
    UNIQUE INDEX `RewardedCleaningSite_name_branchId_key`(`name`, `branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RewardedCleaningSubmission` (
    `id` VARCHAR(191) NOT NULL,
    `userEmail` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `workDate` DATE NOT NULL,
    `status` ENUM('AWAITING_AFTER', 'PENDING_REVIEW', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'AWAITING_AFTER',
    `beforeNote` VARCHAR(500) NULL,
    `afterNote` VARCHAR(500) NULL,
    `aiVerdict` ENUM('PENDING', 'ELIGIBLE', 'NOT_ELIGIBLE', 'SKIPPED') NULL,
    `aiScore` INTEGER NULL,
    `aiNote` TEXT NULL,
    `aiSuggestedCoins` INTEGER NULL,
    `aiVerifiedAt` DATETIME(3) NULL,
    `rewardCoins` INTEGER NULL,
    `reviewerEmail` VARCHAR(191) NULL,
    `reviewerNote` VARCHAR(500) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `afterSubmittedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RewardedCleaningSubmission_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `RewardedCleaningSubmission_userEmail_workDate_idx`(`userEmail`, `workDate`),
    INDEX `RewardedCleaningSubmission_branchId_workDate_idx`(`branchId`, `workDate`),
    UNIQUE INDEX `RewardedCleaningSubmission_userEmail_siteId_workDate_key`(`userEmail`, `siteId`, `workDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RewardedCleaningPhoto` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `phase` ENUM('BEFORE', 'AFTER') NOT NULL,
    `storageName` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RewardedCleaningPhoto_storageName_key`(`storageName`),
    INDEX `RewardedCleaningPhoto_submissionId_phase_sortOrder_idx`(`submissionId`, `phase`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RewardedCleaningSubmission` ADD CONSTRAINT `RewardedCleaningSubmission_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `RewardedCleaningSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RewardedCleaningPhoto` ADD CONSTRAINT `RewardedCleaningPhoto_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `RewardedCleaningSubmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
