-- CreateTable
CREATE TABLE `DonationRequest` (
    `id` VARCHAR(191) NOT NULL,
    `externalKey` VARCHAR(120) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `phone` VARCHAR(48) NULL,
    `email` VARCHAR(191) NOT NULL,
    `donationType` ENUM('CASH', 'IN_KIND') NOT NULL,
    `donationDetail` TEXT NOT NULL,
    `eventName` VARCHAR(200) NULL,
    `eventDetails` TEXT NULL,
    `eventDate` DATE NULL,
    `socialPlatform` VARCHAR(64) NULL,
    `socialHandle` VARCHAR(120) NULL,
    `socialLink` VARCHAR(500) NULL,
    `returnOffer` TEXT NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `rejectNote` TEXT NULL,
    `decidedByEmail` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `couponCount` INTEGER NULL,
    `termType` ENUM('SHORT_TERM', 'LONG_TERM') NULL,
    `couponEmailSentAt` DATETIME(3) NULL,
    `couponEmailError` VARCHAR(500) NULL,
    `source` VARCHAR(32) NOT NULL DEFAULT 'marketing',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DonationRequest_externalKey_key`(`externalKey`),
    INDEX `DonationRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `DonationRequest_email_idx`(`email`),
    INDEX `DonationRequest_eventDate_idx`(`eventDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DonationStayCoupon` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(24) NOT NULL,
    `termType` ENUM('SHORT_TERM', 'LONG_TERM') NOT NULL,
    `benefitUnits` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('ISSUED', 'REDEEMED') NOT NULL DEFAULT 'ISSUED',
    `redeemedAt` DATETIME(3) NULL,
    `redeemedByEmail` VARCHAR(191) NULL,
    `redemptionRef` VARCHAR(191) NULL,
    `discountVnd` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DonationStayCoupon_code_key`(`code`),
    INDEX `DonationStayCoupon_requestId_idx`(`requestId`),
    INDEX `DonationStayCoupon_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DonationFollowUp` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `kind` ENUM('PRE_EVENT', 'POST_EVENT') NOT NULL,
    `scheduledFor` DATETIME(3) NOT NULL,
    `status` ENUM('SCHEDULED', 'SENT', 'SKIPPED', 'FAILED') NOT NULL DEFAULT 'SCHEDULED',
    `sentAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DonationFollowUp_status_scheduledFor_idx`(`status`, `scheduledFor`),
    UNIQUE INDEX `DonationFollowUp_requestId_kind_key`(`requestId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DonationStayCoupon` ADD CONSTRAINT `DonationStayCoupon_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `DonationRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DonationFollowUp` ADD CONSTRAINT `DonationFollowUp_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `DonationRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
