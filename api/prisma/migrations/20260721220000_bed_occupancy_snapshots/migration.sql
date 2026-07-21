CREATE TABLE `BedOccupancySnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `snapshotDate` DATETIME(3) NOT NULL,
    `totalBeds` INTEGER NOT NULL,
    `occupiedBeds` INTEGER NOT NULL,
    `availableBeds` INTEGER NOT NULL,
    `unassignedUsers` INTEGER NOT NULL DEFAULT 0,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BedOccupancySnapshot_month_branchId_key`(`month`, `branchId`),
    INDEX `BedOccupancySnapshot_snapshotDate_idx`(`snapshotDate`),
    INDEX `BedOccupancySnapshot_branchId_snapshotDate_idx`(`branchId`, `snapshotDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
