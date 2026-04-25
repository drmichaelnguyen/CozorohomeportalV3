CREATE TABLE `CleaningContractOptOut` (
    `id` VARCHAR(191) NOT NULL,
    `userEmail` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `contractCode` VARCHAR(191) NOT NULL,
    `cleaningFeeVnd` INTEGER NOT NULL DEFAULT 100000,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CleaningContractOptOut_contractCode_key`(`contractCode`),
    INDEX `CleaningContractOptOut_userEmail_idx`(`userEmail`),
    INDEX `CleaningContractOptOut_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
