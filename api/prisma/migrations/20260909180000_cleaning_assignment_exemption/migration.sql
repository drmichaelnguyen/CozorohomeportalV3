CREATE TABLE `CleaningAssignmentExemption` (
    `userEmail` VARCHAR(191) NOT NULL,
    `exempt` BOOLEAN NOT NULL DEFAULT false,
    `updatedBy` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`userEmail`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
