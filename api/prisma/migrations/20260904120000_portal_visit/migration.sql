-- CreateTable
CREATE TABLE `PortalVisit` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NULL,
    `path` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NULL,
    `device` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PortalVisit_createdAt_idx`(`createdAt`),
    INDEX `PortalVisit_email_createdAt_idx`(`email`, `createdAt`),
    INDEX `PortalVisit_path_createdAt_idx`(`path`, `createdAt`),
    INDEX `PortalVisit_email_path_createdAt_idx`(`email`, `path`, `createdAt`),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
