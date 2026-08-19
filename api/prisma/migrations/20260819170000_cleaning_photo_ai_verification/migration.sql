-- AlterTable
ALTER TABLE `CleaningTask` ADD COLUMN `aiVerdict` ENUM('PENDING', 'ELIGIBLE', 'NOT_ELIGIBLE', 'SKIPPED') NULL,
    ADD COLUMN `aiScore` INTEGER NULL,
    ADD COLUMN `aiNote` TEXT NULL,
    ADD COLUMN `aiVerifiedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `CleaningReferencePhoto` (
    `id` VARCHAR(191) NOT NULL,
    `taskType` ENUM('KITCHEN_D2', 'KITCHEN_D7', 'TRASH_D7') NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `floor` INTEGER NULL,
    `storageName` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `caption` VARCHAR(191) NULL,
    `uploadedBy` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CleaningReferencePhoto_storageName_key`(`storageName`),
    INDEX `CleaningReferencePhoto_taskType_branchId_floor_isActive_idx`(`taskType`, `branchId`, `floor`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CleaningCompletionPhoto` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `storageName` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CleaningCompletionPhoto_storageName_key`(`storageName`),
    INDEX `CleaningCompletionPhoto_taskId_sortOrder_idx`(`taskId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CleaningCompletionPhoto` ADD CONSTRAINT `CleaningCompletionPhoto_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `CleaningTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
