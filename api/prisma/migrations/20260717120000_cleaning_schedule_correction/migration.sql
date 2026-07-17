-- CreateEnum
-- CleaningScheduleCorrectionAction values created inline with table for MySQL

CREATE TABLE `CleaningScheduleCorrectionReason` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `labelVi` VARCHAR(191) NOT NULL,
    `labelEn` VARCHAR(191) NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 100,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CleaningScheduleCorrectionReason_code_key`(`code`),
    INDEX `CleaningScheduleCorrectionReason_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CleaningScheduleCorrection` (
    `id` VARCHAR(191) NOT NULL,
    `action` ENUM('REASSIGN', 'ASSIGN_OVERRIDE', 'REMOVE', 'REPLACE_SYSTEM') NOT NULL,
    `taskId` VARCHAR(191) NULL,
    `slotKey` VARCHAR(191) NULL,
    `taskType` ENUM('KITCHEN_D2', 'KITCHEN_D7', 'TRASH_D7') NOT NULL,
    `scheduledDate` DATETIME(3) NOT NULL,
    `floor` INTEGER NULL,
    `previousUserEmail` VARCHAR(191) NULL,
    `previousUserName` VARCHAR(191) NULL,
    `previousSource` ENUM('SYSTEM', 'MANAGER', 'SELF') NULL,
    `newUserEmail` VARCHAR(191) NULL,
    `actorEmail` VARCHAR(191) NOT NULL,
    `actorName` VARCHAR(191) NULL,
    `customNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CleaningScheduleCorrection_createdAt_idx`(`createdAt`),
    INDEX `CleaningScheduleCorrection_taskType_scheduledDate_idx`(`taskType`, `scheduledDate`),
    INDEX `CleaningScheduleCorrection_actorEmail_createdAt_idx`(`actorEmail`, `createdAt`),
    INDEX `CleaningScheduleCorrection_previousSource_createdAt_idx`(`previousSource`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CleaningScheduleCorrectionReasonLink` (
    `correctionId` VARCHAR(191) NOT NULL,
    `reasonId` VARCHAR(191) NOT NULL,

    INDEX `CleaningScheduleCorrectionReasonLink_reasonId_idx`(`reasonId`),
    PRIMARY KEY (`correctionId`, `reasonId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CleaningScheduleCorrectionReasonLink` ADD CONSTRAINT `CleaningScheduleCorrectionReasonLink_correctionId_fkey` FOREIGN KEY (`correctionId`) REFERENCES `CleaningScheduleCorrection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CleaningScheduleCorrectionReasonLink` ADD CONSTRAINT `CleaningScheduleCorrectionReasonLink_reasonId_fkey` FOREIGN KEY (`reasonId`) REFERENCES `CleaningScheduleCorrectionReason`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
