-- CreateTable
CREATE TABLE `Branch` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Resource` (
    `id` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `type` ENUM('WASHER', 'DRYER', 'AIRFRYER') NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `calendarId` VARCHAR(191) NULL,
    `slotMinutes` INTEGER NOT NULL DEFAULT 60,
    `bufferMinutes` INTEGER NOT NULL DEFAULT 10,
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `Resource_branchId_active_idx`(`branchId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Booking` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(191) NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `status` ENUM('CONFIRMED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'CONFIRMED',
    `gcalEventId` VARCHAR(191) NULL,
    `priceCoins` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Booking_resourceId_startAt_idx`(`resourceId`, `startAt`),
    INDEX `Booking_resourceId_endAt_idx`(`resourceId`, `endAt`),
    INDEX `Booking_resourceId_startAt_endAt_idx`(`resourceId`, `startAt`, `endAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CoinLedger` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `delta` INTEGER NOT NULL,
    `reason` ENUM('BOOKING_CHARGE', 'TOPUP', 'ADJUSTMENT', 'REFUND', 'CLEANING_REWARD', 'CLEANING_REVERSAL') NOT NULL,
    `refType` VARCHAR(191) NULL,
    `refId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CoinLedger_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CleaningAvailability` (
    `id` VARCHAR(191) NOT NULL,
    `userEmail` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `floor` INTEGER NULL,
    `date` DATETIME(3) NOT NULL,
    `type` ENUM('AVAILABLE', 'UNAVAILABLE', 'PREFERRED') NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CleaningAvailability_branchId_date_idx`(`branchId`, `date`),
    UNIQUE INDEX `CleaningAvailability_userEmail_date_key`(`userEmail`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CleaningTask` (
    `id` VARCHAR(191) NOT NULL,
    `userEmail` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `floor` INTEGER NULL,
    `type` ENUM('KITCHEN_D2', 'KITCHEN_D7', 'TRASH_D7') NOT NULL,
    `scheduledDate` DATETIME(3) NOT NULL,
    `calendarId` VARCHAR(191) NULL,
    `calendarEventId` VARCHAR(191) NULL,
    `status` ENUM('ASSIGNED', 'DONE_PENDING_AUDIT', 'APPROVED', 'REJECTED', 'MISSED') NOT NULL DEFAULT 'ASSIGNED',
    `rewardCoins` INTEGER NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `completionNote` VARCHAR(191) NULL,
    `completionPhoto` VARCHAR(191) NULL,
    `auditorNote` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CleaningTask_userEmail_scheduledDate_idx`(`userEmail`, `scheduledDate`),
    INDEX `CleaningTask_branchId_scheduledDate_idx`(`branchId`, `scheduledDate`),
    INDEX `CleaningTask_type_scheduledDate_idx`(`type`, `scheduledDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CleaningAudit` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `reviewer` VARCHAR(191) NOT NULL,
    `decision` ENUM('APPROVE', 'REJECT') NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CleaningAudit_taskId_createdAt_idx`(`taskId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Resource` ADD CONSTRAINT `Resource_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_resourceId_fkey` FOREIGN KEY (`resourceId`) REFERENCES `Resource`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CleaningAudit` ADD CONSTRAINT `CleaningAudit_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `CleaningTask`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
