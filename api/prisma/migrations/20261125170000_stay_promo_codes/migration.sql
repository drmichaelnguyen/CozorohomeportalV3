-- CreateTable
CREATE TABLE `StayPromoCode` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `label` VARCHAR(160) NOT NULL,
    `labelVi` VARCHAR(160) NULL,
    `notes` TEXT NULL,
    `termType` ENUM('LONG_TERM', 'SHORT_TERM', 'BOTH') NOT NULL,
    `benefitType` ENUM('FIXED_VND', 'PERCENT_OFF', 'WAIVE_UNITS') NOT NULL,
    `amountVnd` INTEGER NULL,
    `percentOff` INTEGER NULL,
    `benefitUnits` INTEGER NULL,
    `maxUses` INTEGER NOT NULL DEFAULT 1,
    `usedCount` INTEGER NOT NULL DEFAULT 0,
    `minNights` INTEGER NULL,
    `minMonths` INTEGER NULL,
    `allowedBedsJson` TEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `expiresAt` DATETIME(3) NULL,
    `createdByEmail` VARCHAR(191) NOT NULL,
    `updatedByEmail` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StayPromoCode_code_key`(`code`),
    INDEX `StayPromoCode_enabled_termType_idx`(`enabled`, `termType`),
    INDEX `StayPromoCode_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StayPromoRedemption` (
    `id` VARCHAR(191) NOT NULL,
    `promoCodeId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `termType` ENUM('LONG_TERM', 'SHORT_TERM') NOT NULL,
    `redemptionRef` VARCHAR(191) NOT NULL,
    `discountVnd` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StayPromoRedemption_code_idx`(`code`),
    INDEX `StayPromoRedemption_email_idx`(`email`),
    UNIQUE INDEX `StayPromoRedemption_promoCodeId_redemptionRef_key`(`promoCodeId`, `redemptionRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StayPromoRedemption` ADD CONSTRAINT `StayPromoRedemption_promoCodeId_fkey` FOREIGN KEY (`promoCodeId`) REFERENCES `StayPromoCode`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
