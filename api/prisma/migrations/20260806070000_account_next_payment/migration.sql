-- AlterTable
CREATE TABLE `AccountNextPayment` (
    `email` VARCHAR(255) NOT NULL,
    `nextPaymentDate` DATE NOT NULL,
    `planKind` VARCHAR(20) NULL,
    `sourceContractCode` VARCHAR(120) NULL,
    `updatedBy` VARCHAR(255) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AccountNextPayment_nextPaymentDate_idx`(`nextPaymentDate`),
    PRIMARY KEY (`email`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
