-- CreateTable
CREATE TABLE `CleaningAiBenchmark` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `taskType` ENUM('KITCHEN_D2', 'KITCHEN_D7', 'TRASH_D7') NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `floor` INTEGER NULL,
    `aiVerdict` ENUM('PENDING', 'ELIGIBLE', 'NOT_ELIGIBLE', 'SKIPPED') NOT NULL,
    `aiScore` INTEGER NULL,
    `humanDecision` ENUM('APPROVE', 'REJECT') NOT NULL,
    `aiMatchedHuman` BOOLEAN NOT NULL,
    `reviewer` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CleaningAiBenchmark_createdAt_idx`(`createdAt`),
    INDEX `CleaningAiBenchmark_taskType_branchId_createdAt_idx`(`taskType`, `branchId`, `createdAt`),
    INDEX `CleaningAiBenchmark_aiMatchedHuman_createdAt_idx`(`aiMatchedHuman`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
